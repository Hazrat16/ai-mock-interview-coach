// Representative prompts for the LLM benchmark, sized like the real ones planned for M4 (follow-up
// decision during the interview) and M8 (rubric evaluation after it). They are fixtures for measuring
// speed and JSON reliability, not the final prompts.
import { z } from 'zod';
import type { ChatMessage } from '../../server/src/llm/ollamaClient';

export const followUpSchema = z.object({
  ack: z.string().min(1).max(200),
  action: z.enum(['follow_up', 'next']),
  follow_up: z.string().nullable(),
  summary: z.string().min(1).max(300),
  quality_signal: z.enum(['weak', 'ok', 'strong']),
});

const FOLLOW_UP_SYSTEM = `You are a professional, friendly job interviewer conducting a spoken mock interview.
The candidate hears your words through text-to-speech, so write plain spoken English: no lists, no markdown, no code.

After each candidate answer you decide what happens next and reply with JSON only:
- "ack": one short, neutral acknowledgment of the answer (at most 15 words). Do not praise or criticize; do not reveal a score.
- "action": "follow_up" if a single probing question would reveal something important that the answer left out or kept vague; otherwise "next".
- "follow_up": when action is "follow_up", one specific question (at most 30 words) that refers to something the candidate actually said. Otherwise null.
- "summary": one sentence (at most 25 words) summarizing what the answer covered, used later as context.
- "quality_signal": "weak", "ok" or "strong", your quick impression of the answer's substance (not its delivery).

Rules:
- Never ask a follow-up that repeats the main question or one already asked.
- Ignore filler words, hesitations, accent and grammar; the transcript comes from speech recognition and may contain small errors.
- Do not ask about personal characteristics unrelated to the job.
- Stay within the interview type and the candidate's level.`;

const CONTEXT = `Interview: behavioral, for a Software Engineer (backend), level: junior, difficulty: medium.
Custom instructions: focus on teamwork and ownership.
Topics already covered:
1. Described choosing a database for a university project; compared PostgreSQL and MongoDB at a basic level.
2. Explained how they learned Docker for an internship task within one week using official docs and pairing.`;

const QUESTION = 'Tell me about a time you disagreed with a teammate about a technical decision. What happened?';

export const ANSWERS = [
  `So, um, in my internship we had to build an API for internal reports, and my teammate wanted to put all the logic in
   stored procedures in the database, and I thought it would be better in the service layer because it is easier to
   test. We talked about it in the stand-up and we didn't really agree. Then our mentor suggested we each write a small
   prototype. I wrote the service version with unit tests and he wrote the procedure version. In the end we went with
   my approach mostly because the tests were easier, but we kept one procedure for a heavy aggregation query because it
   was much faster. I learned that it is better to compare with real code instead of arguing.`,
  `I don't really have a lot of conflicts. I usually just go with what the team decides because I'm junior and they
   know more. One time someone wanted to use a different library and I said okay.`,
  `During my final-year project, a teammate wanted to rewrite our Flask backend in Node because he preferred
   JavaScript. Two weeks before the demo, I was worried about the risk. I asked him to list what we would gain, and I
   listed what we would need to redo: authentication, about forty endpoints and the deployment script. We estimated
   the rewrite at around eighty hours. I proposed we keep Flask for the demo and try Node for one new service only,
   the notification worker. He agreed, we shipped the demo on time, and the worker in Node actually worked well, so
   after the demo the team moved two more services. I took ownership of documenting the decision so the next group
   would understand why the stack is mixed.`,
];

export function followUpMessages(answer: string): ChatMessage[] {
  return [
    { role: 'system', content: FOLLOW_UP_SYSTEM },
    { role: 'user', content: `${CONTEXT}\n\nMain question: ${QUESTION}\n\nCandidate answer (transcript):\n${answer}` },
  ];
}

const score = z.number().int().min(0).max(4);
export const evaluationSchema = z.object({
  criteria: z
    .array(
      z.object({
        key: z.enum(['relevance', 'star_structure', 'personal_contribution', 'results_impact', 'reflection']),
        score,
        evidence: z.array(z.string()).max(3),
        rationale: z.string().max(400),
      }),
    )
    .length(5),
  strengths: z.array(z.string()).max(4),
  mistakes: z.array(z.string()).max(4),
  suggestions: z.array(z.string()).max(4),
  example_answer: z.string().max(1500),
  follow_up_exercise: z.string().max(300),
});

const RUBRIC = `Rubric: behavioral interview answer. Score each criterion from 0 to 4 using these anchors.

relevance: Does the answer address the question that was asked?
  0 = unrelated or no answer. 1 = loosely related, mostly off-topic. 2 = related but drifts or answers a different question.
  3 = clearly answers the question with minor detours. 4 = directly and fully answers the question.

star_structure: Is there a clear Situation, Task, Action and Result?
  0 = no structure. 1 = only one element present. 2 = two or three elements, hard to follow.
  3 = all four elements present, some thin. 4 = all four elements clear, in a logical order, concise.

personal_contribution: Is the candidate's own role and decision-making clear (I, not only we)?
  0 = no personal role. 1 = vague personal role. 2 = some personal actions, mostly team actions.
  3 = clear personal actions with some reasoning. 4 = specific personal actions with explicit reasoning and ownership.

results_impact: Are outcomes stated, ideally measurable, and linked to the actions?
  0 = no result. 1 = vague result ("it went fine"). 2 = concrete result, not linked to actions.
  3 = concrete result linked to actions. 4 = measurable result linked to actions, including trade-offs or what changed afterwards.

reflection: Does the candidate show what they learned or would do differently?
  0 = none. 1 = generic statement. 2 = specific lesson, not applied. 3 = specific lesson applied later. 4 = insightful lesson with evidence of applying it.

Rules:
- Judge content only. Never penalize filler words, accent, grammar or transcription errors.
- Every score needs evidence: quote the candidate's exact words (short quotes). If there is no evidence, use an empty list and a score of at most 1.
- Be strict but fair for the stated level (junior).
- strengths, mistakes, suggestions: short, specific, actionable sentences.
- example_answer: a stronger answer to the same question in first person, under 180 words, keeping the candidate's own story where possible.
- follow_up_exercise: one concrete practice task targeting the weakest criterion.`;

export function evaluationMessages(answer: string): ChatMessage[] {
  return [
    { role: 'system', content: `You evaluate mock interview answers and reply with JSON only.\n\n${RUBRIC}` },
    {
      role: 'user',
      content: `Candidate level: junior. Role: Software Engineer (backend).
Question: ${QUESTION}
Expected points: a real disagreement; how it was handled respectfully; the candidate's own actions; the outcome; what was learned.

Answer transcript:
${answer}`,
    },
  ];
}
