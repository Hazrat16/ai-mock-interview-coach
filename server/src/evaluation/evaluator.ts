// Scores one interview question (the main answer plus any follow-ups) against the rubric with the evaluator
// model. The model scores criteria and writes feedback; the overall score and the evidence check are code.
import { z } from 'zod';
import type { DocumentContext } from '@shared/schemas/documents';
import type { EvaluationResult } from '@shared/schemas/evaluation';
import type { InterviewConfig } from '@shared/schemas/interview';
import { type ChatMessage, type OllamaClient, NUM_CTX } from '../llm/ollamaClient';
import { structuredChat } from '../llm/structured';
import { quoteSupported } from './evidence';
import type { Rubric } from './rubrics';
import { overallScore } from './scoring';

/** Bump when the prompt or the output schema changes. */
export const EVALUATION_PROMPT_VERSION = 3;

export type Exchange = { kind: 'main' | 'follow_up'; question: string; answer: string | null };

export type EvaluationInput = {
  rubric: Rubric;
  config: InterviewConfig;
  exchange: Exchange[];
  /** From the question bank: what a good answer covers. */
  expectedPoints: string[];
  /** Resume or job-description interviews: the document's summary. */
  document?: DocumentContext;
};

const MAX_TRANSCRIPT_CHARS = 6000; // ~1500 tokens; long answers are clipped to keep CPU time reasonable

/**
 * The model's reply. Within each criterion it quotes and reasons before it scores (generation follows field
 * order). Long text fields have no length limit: Ollama enforces limits while generating, which cut sentences
 * off in M3; the prompt asks for brevity instead.
 */
export function modelSchema(rubric: Rubric) {
  const keys = rubric.criteria.map((c) => c.key) as [string, ...string[]];
  return z.object({
    // Written first: having named what the recognizer misheard, the model stops counting it as a mistake.
    misheard: z.array(z.object({ heard: z.string(), meant: z.string() })).max(12),
    criteria: z
      .array(
        z.object({
          key: z.enum(keys),
          evidence: z.array(z.string()).max(3),
          rationale: z.string().min(1),
          score: z.number().int().min(0).max(4),
        }),
      )
      .length(keys.length)
      .refine((cs) => new Set(cs.map((c) => c.key)).size === keys.length, {
        message: `each criterion exactly once: ${keys.join(', ')}`,
      }),
    strengths: z.array(z.string()).max(4),
    mistakes: z.array(z.string()).max(4),
    missing_concepts: z.array(z.string()).max(5),
    suggestions: z.array(z.string()).max(4),
    example_answer: z.string().min(1),
    follow_up_exercise: z.string().min(1),
  });
}
export type ModelEvaluation = z.infer<ReturnType<typeof modelSchema>>;

function rubricText(rubric: Rubric) {
  const criteria = rubric.criteria
    .map((c) => `${c.key}: ${c.question}\n${c.anchors.map((a, i) => `  ${i} = ${a}`).join('\n')}`)
    .join('\n\n');
  return `Rubric: ${rubric.title}. Score each criterion from 0 to 4 using these anchors.\n\n${criteria}`;
}

export function buildMessages(input: EvaluationInput): ChatMessage[] {
  const { rubric, config, exchange, expectedPoints } = input;
  const level = config.level === 'mid' ? 'mid-level' : config.level;
  const system = `You evaluate mock interview answers and reply with JSON only.

${rubricText(rubric)}

${rubric.notes}

Rules:
- The exchange may include follow-up questions; judge the candidate's answers together, as one answer to the main question.
- Judge content only. The answers are automatic speech transcripts, and speech recognition often mishears technical terms as similar-sounding words (for example "rest condition" for race condition, "Java stripped" for JavaScript, "beetries" for B-trees, "my school" for MySQL or NoSQL). First list them in "misheard" (what the transcript says, and the term meant), then read them as that term everywhere. Never list them as mistakes, and never lower any score, including clarity, for them, or for filler words, accent or grammar. Clarity is about how the answer is organized.
- For each criterion, first give evidence: up to 3 short quotes copied exactly from the candidate's words that match the anchor you choose; vague words count too (for example "it was fine" for a vague result). Then the rationale (one or two sentences). Then the score. Use an empty list only when nothing in the answer relates to the criterion.
- Pick the anchor whose description best matches the answer, for a ${level} candidate. 0 means the answer has nothing at all for that criterion; a vague, generic or thin attempt is 1 or 2, not 0. Give 4 only when everything in the anchor-4 description applies.
- strengths, mistakes, missing_concepts, suggestions: short, specific, actionable sentences. missing_concepts: important points the answer did not cover.
- example_answer: a stronger answer to the main question in first person, under 180 words, keeping the candidate's own story where possible.
- follow_up_exercise: one concrete practice task (one or two sentences) targeting the weakest criterion.`;

  let transcript = exchange
    .map(
      (e) =>
        `Interviewer${e.kind === 'follow_up' ? ' (follow-up)' : ''}: ${e.question}\nCandidate: ${e.answer ?? '(skipped)'}`,
    )
    .join('\n\n');
  if (transcript.length > MAX_TRANSCRIPT_CHARS) transcript = `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)} [...]`;

  const user = [
    `Candidate level: ${level}. Role: ${config.jobTitle}. Interview type: ${config.interviewType.replace('_', ' ')}.`,
    config.customInstructions ? `Interview focus: ${config.customInstructions}` : '',
    expectedPoints.length ? `Expected points for the main question: ${expectedPoints.join('; ')}.` : '',
    `\nExchange:\n${transcript}`,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** The candidate's own words, for checking the evaluator's quotes. */
export const candidateText = (exchange: Exchange[]) => exchange.map((e) => e.answer ?? '').join(' ');

/** Safeguards (08-testing-quality.md §2): a short answer cannot score above this, whatever the model says. */
export const SHORT_ANSWER_WORDS = 20;
export const SHORT_ANSWER_MAX = 30;

/**
 * Turns the model's reply into the stored result: names, weights, anchors, checked evidence, overall score.
 * A criterion with no quote found in the answer is capped at 1: a score must rest on the candidate's words.
 */
export function toResult(rubric: Rubric, m: ModelEvaluation, candidate: string) {
  const byKey = new Map(m.criteria.map((c) => [c.key, c]));
  const criteria = rubric.criteria.map((c) => {
    const got = byKey.get(c.key)!;
    const evidence = got.evidence
      .map((q) => q.trim())
      .filter(Boolean)
      .map((quote) => ({ quote, supported: quoteSupported(quote, candidate) }));
    const score = evidence.some((e) => e.supported) ? got.score : Math.min(got.score, 1);
    return {
      key: c.key,
      name: c.name,
      weight: c.weight,
      score,
      rationale: got.rationale.trim(),
      evidence,
      anchor: c.anchors[score]!,
    };
  });
  const words = candidate.split(/\s+/).filter(Boolean).length;
  const overall = overallScore(rubric, Object.fromEntries(criteria.map((c) => [c.key, c.score])));
  const result: EvaluationResult = {
    criteria,
    strengths: m.strengths,
    mistakes: m.mistakes,
    missingConcepts: m.missing_concepts,
    suggestions: m.suggestions,
    exampleAnswer: m.example_answer.trim(),
    followUpExercise: m.follow_up_exercise.trim(),
  };
  return {
    result,
    overall: words < SHORT_ANSWER_WORDS ? Math.min(overall, SHORT_ANSWER_MAX) : overall,
    unsupported: criteria.reduce((n, c) => n + c.evidence.filter((e) => !e.supported).length, 0),
  };
}

export async function evaluate(
  llm: OllamaClient,
  input: EvaluationInput,
  opts: { model: string; numThread?: number; timeoutMs?: number; signal?: AbortSignal; seed?: number },
) {
  const started = performance.now();
  const reply = await structuredChat(llm, {
    model: opts.model,
    schema: modelSchema(input.rubric),
    messages: buildMessages(input),
    // Low temperature and a fixed seed: the same answer should get the same scores (checked in M9).
    options: { temperature: 0.1, seed: opts.seed ?? 42, num_ctx: NUM_CTX, num_predict: 2000, num_thread: opts.numThread },
    keepAlive: '5m',
    timeoutMs: opts.timeoutMs ?? 600_000,
    signal: opts.signal,
  });
  return {
    ...toResult(input.rubric, reply.data, candidateText(input.exchange)),
    ms: Math.round(performance.now() - started),
    attempts: reply.attempts,
  };
}
