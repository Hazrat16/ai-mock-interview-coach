import { z } from 'zod';
import type { DocumentContext } from '@shared/schemas/documents';
import { DIFFICULTIES, type InterviewConfig } from '@shared/schemas/interview';
import { type OllamaClient, NUM_CTX } from '../llm/ollamaClient';
import { structuredChat } from '../llm/structured';

const generatedSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string().min(15),
      difficulty: z.enum(DIFFICULTIES),
      skills: z.array(z.string()).min(1),
      expected_points: z.array(z.string()).min(2),
    }),
  ),
});
export type GeneratedQuestion = z.infer<typeof generatedSchema>['questions'][number];

/** Writes new interview questions when the local bank has too few for the chosen settings. */
export async function generateQuestions(
  llm: OllamaClient,
  opts: { model: string; numThread?: number },
  config: InterviewConfig,
  count: number,
  avoid: string[],
): Promise<GeneratedQuestion[]> {
  const difficulty = config.difficulty === 'adaptive' ? 'medium' : config.difficulty;
  const prompt = [
    `Write ${count} distinct ${config.interviewType.replace('_', ' ')} interview questions for a ${config.level} ${config.jobTitle} (job family: ${config.jobFamily.replace('_', ' ')}).`,
    `Target difficulty: ${difficulty}. Each question must be answerable out loud in two to four minutes, without writing code.`,
    'For each: the question text, its difficulty, the skills it tests (snake_case words), and 3-5 points a strong answer covers.',
    config.customInstructions ? `Candidate's focus: ${config.customInstructions}` : '',
    avoid.length ? `Do not repeat or closely rephrase these existing questions:\n- ${avoid.join('\n- ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const result = await structuredChat(llm, {
    model: opts.model,
    schema: generatedSchema,
    messages: [
      {
        role: 'system',
        content:
          'You are an experienced interviewer who writes clear, realistic interview questions. Reply with JSON only.',
      },
      { role: 'user', content: prompt },
    ],
    options: { temperature: 0.8, num_ctx: NUM_CTX, num_predict: 300 * count, num_thread: opts.numThread },
    keepAlive: '10m',
    timeoutMs: 240_000,
  });
  return result.data.questions.slice(0, count);
}

const fromDocumentSchema = z.object({
  questions: z.array(
    z.object({
      // Written first: the model picks what the question is about before writing it.
      based_on: z.string().min(2),
      text: z.string().min(15),
      difficulty: z.enum(DIFFICULTIES),
      skills: z.array(z.string()).min(1),
      expected_points: z.array(z.string()).min(2),
    }),
  ),
});
export type DocumentQuestion = z.infer<typeof fromDocumentSchema>['questions'][number];

const FOCUS = {
  job_description:
    "Each question tests one of the job's required skills or responsibilities, names it, and is set in the kind of work " +
    'this job involves. Cover different skills. based_on: the skill or responsibility.',
  company_notes:
    'Each question is one this company is likely to ask, given only what the notes say about its values, interview ' +
    'process, work and what it looks for. Do not invent facts about the company. based_on: the point from the notes.',
  resume:
    "Each question asks about a specific project or role from the candidate's resume, by name: what they built and why, " +
    'decisions and trade-offs, problems they solved, results. Cover different projects. Expected points describe what a ' +
    'strong answer about that project would include, without inventing facts. based_on: the project or role.',
};

/** Behavioral and HR questions ask for a story, not for technical detail. */
const STORY =
  'These are behavioral questions: each asks for a story from that project, role or kind of work: a challenge, a ' +
  'disagreement, a mistake, a deadline or a decision, what the candidate did, and the result. Not technical details.';

/**
 * Writes interview questions from a summary: of a job description or resume (R21, R22), or of your notes about a
 * company (predictions, R23).
 */
export async function generateFromDocument(
  llm: OllamaClient,
  opts: { model: string; numThread?: number },
  config: InterviewConfig,
  doc: DocumentContext,
  count: number,
): Promise<DocumentQuestion[]> {
  const difficulty = config.difficulty === 'adaptive' ? 'medium' : config.difficulty;
  const what = {
    resume: "The candidate's resume",
    job_description: 'The job description',
    company_notes: "The candidate's notes about the company",
  }[doc.kind];
  const prompt = [
    `Write ${count} distinct ${config.interviewType.replace('_', ' ')} interview questions for a ${config.level} ${config.jobTitle}.`,
    FOCUS[doc.kind],
    config.interviewType === 'behavioral' || config.interviewType === 'hr' ? STORY : '',
    `Target difficulty: ${difficulty}. Each question must be answerable out loud in two to four minutes, without writing code.`,
    'For each: what it is based on, the question text, its difficulty, the skills it tests (snake_case words), and 3-5 points a strong answer covers.',
    config.customInstructions ? `Candidate's focus: ${config.customInstructions}` : '',
    `${what} (summary):\n${doc.summary}`,
  ]
    .filter(Boolean)
    .join('\n');

  const result = await structuredChat(llm, {
    model: opts.model,
    schema: fromDocumentSchema,
    messages: [
      {
        role: 'system',
        content:
          'You are an experienced interviewer who writes clear, realistic interview questions. Reply with JSON only.',
      },
      { role: 'user', content: prompt },
    ],
    options: { temperature: 0.7, num_ctx: NUM_CTX, num_predict: 300 * count, num_thread: opts.numThread },
    keepAlive: '10m',
    timeoutMs: 360_000,
  });
  return result.data.questions.slice(0, count);
}
