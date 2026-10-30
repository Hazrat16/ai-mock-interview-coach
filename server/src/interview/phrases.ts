// Fixed interviewer phrases. Chosen in code rather than by the model: they are instant, always
// neutral (never praise or criticize), and pre-synthesized to audio at startup (FIXED_PHRASES).
import type { InterviewConfig } from '@shared/schemas/interview';

const TYPE_NAMES: Record<InterviewConfig['interviewType'], string> = {
  hr: 'general',
  behavioral: 'behavioral',
  technical: 'technical',
  coding: 'coding',
  system_design: 'system design',
};

export const ACKS = ['Thank you.', 'Okay, thanks.', 'Got it, thank you.', 'Thanks for that.', 'All right.'];
export const LEADS = ['Next question.', "Let's move on.", 'Here is the next one.', 'Moving on.'];

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
  if (questionNumber === total && total > 1) return LAST_LEAD;
  return pick(LEADS, questionNumber);
}

export const CLOSING =
  "That's the end of the interview. Thank you for your time. You can review your answers on the next screen.";

export const LAST_LEAD = 'And the last question.';

/**
 * Asked when the model judged the answer weak and wanted a follow-up, but its wording only repeated the main
 * question ("Can you give a specific example of <main question>?"). Neutral; one set for questions about your
 * experience, one for questions about how things work (asking "what you did yourself" after "Explain the
 * event loop" made no sense).
 */
export const PROBES = {
  experience: [
    'Could you walk me through one specific example, and what you did yourself?',
    'Can you make that more concrete? Pick one real situation and tell me what happened.',
  ],
  technical: [
    'Could you make that more concrete? Walk me through a specific example, step by step.',
    'What would you watch out for in practice? Think of trade-offs or edge cases.',
  ],
};

/** The probes in simpler words, for "I don't understand" (the model reworded them into the main question). */
export const PROBES_REWORDED: Record<string, string> = {
  [PROBES.experience[0]!]: 'Think of one real time this happened. What did you do yourself, step by step?',
  [PROBES.experience[1]!]: 'Tell me about one real situation. What happened, and what was the result?',
  [PROBES.technical[0]!]: 'Pick one small example and tell me what happens in it, one step at a time.',
  [PROBES.technical[1]!]: 'When you use this in a real project, what can go wrong, or what does it cost you?',
};

export const probesFor = (type: InterviewConfig['interviewType']) =>
  type === 'hr' || type === 'behavioral' ? PROBES.experience : PROBES.technical;

/** Said before the question is asked again after "Sorry, I don't understand the question." */
export const CLARIFY_REPHRASED = 'Sure, let me put it another way.';
export const CLARIFY_REPEATED = 'Sure, here it is again.';

/** Every fixed sentence the interviewer says, for the text-to-speech cache. */
export const FIXED_PHRASES = [
  ...ACKS,
  ...LEADS,
  LAST_LEAD,
  ...PROBES.experience,
  ...PROBES.technical,
  ...Object.values(PROBES_REWORDED),
  CLARIFY_REPHRASED,
  CLARIFY_REPEATED,
  "That's the end of the interview.",
  'Thank you for your time.',
];
