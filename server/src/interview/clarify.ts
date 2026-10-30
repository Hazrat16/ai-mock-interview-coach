// "Sorry, I don't understand the question": the interviewer asks it again in simpler words instead of
// treating the reply as an answer and moving on.
import { z } from 'zod';
import type { InterviewConfig } from '@shared/schemas/interview';
import { OllamaError, type OllamaClient, NUM_CTX } from '../llm/ollamaClient';
import { StructuredOutputError, structuredChat } from '../llm/structured';

/** Longer replies are answers, even if they say "I don't understand" somewhere. */
const MAX_WORDS = 30;

const REQUESTS = [
  /\b(i )?(do not|don'?t|didn'?t|did not|couldn'?t|could not|can'?t|cannot)( really| quite| fully)? (understand|get|follow|catch|hear)\b/,
  /\b(can|could|would) you( please)? (repeat|rephrase|clarify|explain the question|say (that|it) again|ask (that|it) again)\b/,
  /\bwhat (do|did) you mean\b/,
  /\bwhat does (it|that|this|the question) mean\b/,
  /\bnot sure what you('re| are)? (asking|mean)\b/,
  /\b(repeat|rephrase) the question\b/,
  /^(sorry|pardon)[?.!]*$/,
];

/** True when the reply asks for the question to be repeated or explained instead of answering it. */
export function isClarificationRequest(transcript: string): boolean {
  const text = transcript.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  if (!text || text.split(' ').length > MAX_WORDS) return false;
  return REQUESTS.some((r) => r.test(text));
}

// The model names the topic in plain words before it rewords: without that step it often returned the
// original question unchanged.
const rephraseSchema = z.object({ topic: z.string().min(1), question: z.string().min(10).max(400) });

const SYSTEM = `You are a job interviewer running a spoken mock interview. The candidate did not understand your question. Ask it again so it is easier to understand. Reply with JSON only.

Fields, in this order:
- "topic": what the question is about, in a few plain words.
- "question": the question asked again. Start by naming the topic ("Let's talk about ..."), then ask in different, simpler words than the original.

Rules:
- If the question has several parts, ask only the first part now.
- If the candidate asked about a specific part, reword that part.
- Never explain or define the concepts the question asks about: the candidate has to explain them. Do not hint at the answer.
- For a follow-up question, reword the follow-up, not the main question.
- It must still ask for the same thing, as a question. Never repeat the original wording. Plain spoken English, one or two short sentences, under 40 words.`;

/** The question in other words, or null when the model is unavailable, slow or its reply is unusable. */
export async function rephrase(
  llm: OllamaClient,
  opts: { model: string; numThread?: number; timeoutMs: number },
  ctx: {
    config: InterviewConfig;
    question: string;
    /** For a follow-up: the main question it belongs to (a probe like "Can you make that concrete?" needs it). */
    mainQuestion?: string;
    request: string;
  },
): Promise<string | null> {
  const { config } = ctx;
  try {
    const r = await structuredChat(llm, {
      model: opts.model,
      schema: rephraseSchema,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            `Interview: ${config.interviewType.replace('_', ' ')}, role: ${config.jobTitle}, level: ${config.level}.`,
            ctx.mainQuestion
              ? `Main question: ${ctx.mainQuestion}\nFollow-up question: ${ctx.question}`
              : `Question: ${ctx.question}`,
            `Candidate said: ${ctx.request}`,
          ].join('\n'),
        },
      ],
      options: { temperature: 0.3, num_ctx: NUM_CTX, num_predict: 120, num_thread: opts.numThread },
      keepAlive: '15m',
      timeoutMs: opts.timeoutMs,
    });
    const q = r.data.question.trim();
    return q.toLowerCase() === ctx.question.trim().toLowerCase() ? null : q;
  } catch (err) {
    if (err instanceof OllamaError || err instanceof StructuredOutputError) return null;
    throw err;
  }
}
