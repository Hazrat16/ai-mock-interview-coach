// Writes the interview-ready answer for one question, without scoring it: one short generation instead of
// criteria, quotes and feedback (used while scoring is off; see shared/features.ts).
import { z } from 'zod';
import type { EvaluationResult } from '@shared/schemas/evaluation';
import { type OllamaClient, NUM_CTX } from '../llm/ollamaClient';
import { structuredChat } from '../llm/structured';
import type { EvaluationInput } from './evaluator';

/** Bump when the prompt or the output schema changes. */
export const READY_ANSWER_PROMPT_VERSION = 1;

const schema = z.object({ example_answer: z.string().min(1) });

const MAX_TRANSCRIPT_CHARS = 6000;

export function buildReadyAnswerMessages(input: EvaluationInput) {
  const { config, exchange, expectedPoints } = input;
  const level = config.level === 'mid' ? 'mid-level' : config.level;
  const system = `You coach candidates for job interviews and reply with JSON only: {"example_answer": "..."}.

Write the interview-ready answer to the main question: what a strong ${level} ${config.jobTitle} candidate would say out loud.
- First person, spoken style, under 180 words. No headings, lists, markdown or code.
- Keep the candidate's own story, examples and correct points; fix what was wrong; add the expected points they missed.
- The candidate's words are automatic speech transcripts: technical terms are often misheard as similar-sounding words (for example "rest condition" for race condition, "beetries" for B-trees). Read them as the term meant.
- If the candidate gave no usable answer, write a strong answer from scratch.`;

  let transcript = exchange
    .map(
      (e) =>
        `Interviewer${e.kind === 'follow_up' ? ' (follow-up)' : ''}: ${e.question}\nCandidate: ${e.answer ?? '(skipped)'}`,
    )
    .join('\n\n');
  if (transcript.length > MAX_TRANSCRIPT_CHARS) transcript = `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)} [...]`;

  const user = [
    `Interview type: ${config.interviewType.replace('_', ' ')}.`,
    config.customInstructions ? `Interview focus: ${config.customInstructions}` : '',
    expectedPoints.length ? `Expected points for the main question: ${expectedPoints.join('; ')}.` : '',
    input.document?.kind === 'resume'
      ? `The candidate's resume (summary; use its real projects and facts, invent no others):\n${input.document.summary}`
      : '',
    input.document?.kind === 'job_description'
      ? `The job description (summary; connect the answer to it):\n${input.document.summary}`
      : '',
    input.document?.kind === 'company_notes'
      ? `The candidate's notes about the company (summary; connect the answer to them where it fits):\n${input.document.summary}`
      : '',
    `\nExchange:\n${transcript}`,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

export async function prepareReadyAnswer(
  llm: OllamaClient,
  input: EvaluationInput,
  opts: { model: string; numThread?: number; timeoutMs?: number; signal?: AbortSignal },
) {
  const started = performance.now();
  const reply = await structuredChat(llm, {
    model: opts.model,
    schema,
    messages: buildReadyAnswerMessages(input),
    options: { temperature: 0.2, seed: 42, num_ctx: NUM_CTX, num_predict: 600, num_thread: opts.numThread },
    keepAlive: '5m',
    timeoutMs: opts.timeoutMs ?? 300_000,
    signal: opts.signal,
  });
  const result: EvaluationResult = {
    criteria: [],
    strengths: [],
    mistakes: [],
    missingConcepts: [],
    suggestions: [],
    exampleAnswer: reply.data.example_answer.trim(),
    followUpExercise: '',
  };
  return { result, ms: Math.round(performance.now() - started) };
}
