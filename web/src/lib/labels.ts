import type { InterviewConfig } from '@shared/schemas/interview';

export const INTERVIEW_TYPE_LABELS: Record<InterviewConfig['interviewType'], string> = {
  hr: 'HR / general',
  behavioral: 'Behavioral',
  technical: 'Technical',
  coding: 'Coding (talk through)',
  system_design: 'System design',
};

export const JOB_FAMILY_LABELS: Record<InterviewConfig['jobFamily'], string> = {
  software_engineering: 'Software engineering',
  data: 'Data / ML',
  product: 'Product',
  design: 'Design',
  other: 'Other',
};

export const LEVEL_LABELS: Record<InterviewConfig['level'], string> = {
  intern: 'Intern',
  junior: 'Junior',
  mid: 'Mid-level',
  senior: 'Senior',
  lead: 'Lead',
};

export const DIFFICULTY_LABELS: Record<InterviewConfig['difficulty'], string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  adaptive: 'Adaptive (starts at medium)',
};
