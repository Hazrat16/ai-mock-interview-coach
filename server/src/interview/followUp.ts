import { z } from 'zod';
import type { InterviewConfig } from '@shared/schemas/interview';
import { type ChatMessage, OllamaError, type OllamaClient, NUM_CTX } from '../llm/ollamaClient';
import { StructuredOutputError, structuredChat } from '../llm/structured';

/** Bump when the prompt or schema changes, so stored results can be traced to it. */
export const FOLLOW_UP_PROMPT_VERSION = 2;

// Field order matters: the model writes them in this order, so it judges the answer (summary, quality)
// before it decides. With "action" first, granite rated answers "weak" and still chose "next" (M7, v1).
export const decisionSchema = z.object({
  summary: z.string().min(1),
  quality_signal: z.enum(['weak', 'ok', 'strong']),
  action: z.enum(['follow_up', 'next']),
  follow_up: z.string().nullable(),
});
export type Decision = z.infer<typeof decisionSchema>;

export const FOLLOW_UP_SYSTEM = `You are a job interviewer running a spoken mock interview. After each candidate answer you decide whether to ask one follow-up question. Reply with JSON only.

Fields, in this order:
- "summary": one sentence (under 25 words) stating what the answer covered.
- "quality_signal": "weak", "ok" or "strong": the substance of the answer for this level.
- "action": "follow_up" if the answer left out or kept vague something important for this question (for example a concrete example, the candidate's own role, a result, the reasoning behind a choice, a trade-off, or an edge case). An answer you rated "weak", or one without a concrete example when the question asks for one, gets "follow_up". A complete answer gets "next".
- "follow_up": when action is "follow_up", ONE short spoken question (under 30 words) that builds on something the candidate actually said, and asks for what is missing. It must not repeat or rephrase the main question or an earlier follow-up. Otherwise null.

Rules:
- Plain spoken English: no lists, markdown or code in the follow-up.
- Judge content only. The transcript may contain filler words, hesitations and recognition errors; ignore them.
- Never ask about personal matters unrelated to the job.`;

export type DecisionContext = {
  config: InterviewConfig;
  coveredTopics: string[];
  mainQuestion: string;
  /** Earlier follow-ups on this main question with their answers. */
  thread: { question: string; answer: string }[];
  answer: string;
};

const MAX_ANSWER_CHARS = 2400; // ~600 tokens; keeps the prompt small for CPU inference
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} [...]` : s);

export function buildMessages(ctx: DecisionContext): ChatMessage[] {
  const { config } = ctx;
  const lines = [
    `Interview: ${config.interviewType.replace('_', ' ')}, role: ${config.jobTitle}, level: ${config.level}, difficulty: ${config.difficulty}.`,
  ];
  if (config.customInstructions)
    lines.push(`Candidate's instructions for this interview: ${config.customInstructions}`);
  if (ctx.coveredTopics.length) {
    lines.push('Topics already covered:', ...ctx.coveredTopics.map((t, i) => `${i + 1}. ${t}`));
  }
  lines.push('', `Main question: ${ctx.mainQuestion}`);
  for (const t of ctx.thread) lines.push(`Follow-up asked: ${t.question}`, `Answer: ${clip(t.answer, 800)}`);
  lines.push(
    ctx.thread.length ? `Answer to the latest follow-up (transcript):` : `Candidate answer (transcript):`,
    clip(ctx.answer, MAX_ANSWER_CHARS),
  );
  return [
    { role: 'system', content: FOLLOW_UP_SYSTEM },
    { role: 'user', content: lines.join('\n') },
  ];
}

const STOP_WORDS = new Set(
  'a an and are as at be about can could did do does for from have how i in is it me of on or so tell that the this to was what when where which who why with would you your'.split(
    ' ',
  ),
);
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w)),
  );

/**
 * How much of the shorter question's content words the other one repeats (overlap coefficient, 0..1),
 * and how many words that is. Measured against the shorter one so that wrapping a repeat in extra
 * words ("Can you give a specific example of...") does not hide it.
 */
export function similarity(a: string, b: string): { overlap: number; common: number } {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return { overlap: 0, common: 0 };
  const common = [...wa].filter((w) => wb.has(w)).length;
  return { overlap: common / Math.min(wa.size, wb.size), common };
}

// A repeat shares most content words, and at least three: a short follow-up that reuses two key
// terms ("What was the technical decision exactly?") is still a real follow-up.
const isRepeat = (a: string, b: string) => {
  const s = similarity(a, b);
  return s.overlap >= 0.6 && s.common >= 3;
};

/**
 * The follow-up to ask, if any: the model's own when it is new, otherwise (weak answer, model's wording
 * rejected) one of `probes` (see probesFor) not asked yet on this question.
 */
export function chooseFollowUp(decision: Decision, previous: string[], probes: string[]): string | null {
  const own = acceptFollowUp(decision, previous);
  if (own || decision.action !== 'follow_up' || decision.quality_signal !== 'weak') return own;
  return probes.find((p) => !previous.includes(p)) ?? null;
}

/** A follow-up is used only if it is a real, new question; otherwise the interview moves on. */

export function acceptFollowUp(decision: Decision, previous: string[]): string | null {
  const q = decision.follow_up?.trim();
  if (decision.action !== 'follow_up' || !q || q.length < 10 || q.length > 400) return null;
  if (previous.some((p) => isRepeat(q, p))) return null;
  return q;
}

export type DecideResult = { decision: Decision | null; error?: string; ms: number };

/**
 * Asks the interviewer model. Never throws: when the model is unavailable, slow or invalid,
 * returns decision null and the interview simply continues with the next planned question.
 */
export async function decide(
  llm: OllamaClient,
  opts: { model: string; numThread?: number; timeoutMs: number },
  ctx: DecisionContext,
): Promise<DecideResult> {
  const started = performance.now();
  try {
    const result = await structuredChat(llm, {
      model: opts.model,
      schema: decisionSchema,
      messages: buildMessages(ctx),
      options: { temperature: 0.4, num_ctx: NUM_CTX, num_predict: 200, num_thread: opts.numThread },
      keepAlive: '15m',
      timeoutMs: opts.timeoutMs,
    });
    return { decision: result.data, ms: Math.round(performance.now() - started) };
  } catch (err) {
    if (err instanceof OllamaError || err instanceof StructuredOutputError) {
      return { decision: null, error: err.message, ms: Math.round(performance.now() - started) };
    }
    throw err;
  }
}

/**
 * Loads the model and caches the system prompt (Ollama reuses the cached prefix), so the first real
 * turn is not slowed by loading. Fire-and-forget.
 */
export async function warmUp(llm: OllamaClient, model: string, numThread?: number) {
  await llm
    .chat({
      model,
      messages: [
        { role: 'system', content: FOLLOW_UP_SYSTEM },
        { role: 'user', content: 'Reply with {}' },
      ],
      options: { num_ctx: NUM_CTX, num_predict: 1, num_thread: numThread },
      keepAlive: '15m',
      timeoutMs: 120_000,
    })
    .catch(() => undefined);
}
