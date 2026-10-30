import type { InterviewConfig } from '@shared/schemas/interview';
import { behavioral } from './behavioral';
import { coding } from './coding';
import { systemDesign } from './systemDesign';
import { technical } from './technical';
import type { Rubric } from './types';

export type { Criterion, Rubric } from './types';
export const RUBRICS: readonly Rubric[] = [behavioral, technical, coding, systemDesign];

/** HR interviews use the behavioral rubric (R8). */
export function rubricFor(type: InterviewConfig['interviewType']): Rubric {
  if (type === 'hr' || type === 'behavioral') return behavioral;
  if (type === 'technical') return technical;
  if (type === 'coding') return coding;
  return systemDesign;
}

export function rubricByKey(key: string): Rubric | undefined {
  return RUBRICS.find((r) => r.key === key);
}
