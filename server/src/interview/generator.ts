import { z } from 'zod';
import { DIFFICULTIES, type InterviewConfig } from '@shared/schemas/interview';
import type { OllamaClient } from '../llm/ollamaClient';
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
    options: { temperature: 0.8, num_ctx: 8192, num_predict: 300 * count, num_thread: opts.numThread },
    keepAlive: '10m',
    timeoutMs: 240_000,
  });
  return result.data.questions.slice(0, count);
}
