// Fixed interviewer phrases. Chosen in code rather than by the model: they are instant, always
// neutral (never praise or criticize), and in M5 they can be pre-synthesized to audio.
import type { InterviewConfig } from '@shared/schemas/interview';

const TYPE_NAMES: Record<InterviewConfig['interviewType'], string> = {
  hr: 'general',
  behavioral: 'behavioral',
  technical: 'technical',
  coding: 'coding',
  system_design: 'system design',
};

export const ACKS = ['Thank you.', 'Okay, thanks.', 'Got it, thank you.', 'Thanks for that.', 'All right.'];
const LEADS = ['Next question.', "Let's move on.", 'Here is the next one.', 'Moving on.'];

/** Rotates through the list so consecutive turns sound different but runs stay reproducible. */
export const pick = (list: string[], n: number) => list[n % list.length]!;

export function intro(config: InterviewConfig, total: number) {
  const level = config.level === 'mid' ? 'mid-level' : config.level;
  const count = total === 1 ? 'one question' : `${total} questions`;
  return (
    `Hello, and thanks for joining. This is a ${TYPE_NAMES[config.interviewType]} interview for a ${level} ` +
    `${config.jobTitle} role. I have ${count} for you, and I may ask a short follow-up now and then. ` +
    `Take your time with each answer. Let's begin.`
  );
}

export function lead(questionNumber: number, total: number) {
  if (questionNumber === total && total > 1) return 'And the last question.';
  return pick(LEADS, questionNumber);
}

export const CLOSING =
  "That's the end of the interview. Thank you for your time. You can review your answers on the next screen.";
