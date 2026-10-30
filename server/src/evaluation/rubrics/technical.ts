import type { Rubric } from './types';

export const technical: Rubric = {
  key: 'technical',
  version: 1,
  title: 'Technical answer',
  notes:
    'Technical answers are spoken, not written: judge the ideas, not exact syntax or names. A correct idea with a ' +
    'transcription error in a term (e.g. "post gres") counts as correct.',
  criteria: [
    {
      key: 'correctness',
      name: 'Correctness',
      skill: 'technical_accuracy',
      weight: 0.3,
      question: 'Are the statements technically correct?',
      anchors: [
        'Mostly wrong, or no technical content.',
        'Some correct ideas mixed with significant errors.',
        'Mostly correct with a notable error or gap.',
        'Correct, with minor imprecisions.',
        'Fully correct and precise.',
      ],
    },
    {
      key: 'depth',
      name: 'Depth',
      skill: 'technical_depth',
      weight: 0.2,
      question: 'Does the answer go beyond the surface: how and why, not only what?',
      anchors: [
        'Only buzzwords.',
        'Surface definitions only.',
        'Explains how it works at a basic level.',
        'Explains how and why, with relevant details.',
        'Shows deep understanding: internals, limits, or real-world experience.',
      ],
    },
    {
      key: 'reasoning',
      name: 'Reasoning',
      skill: 'problem_solving',
      weight: 0.2,
      question: 'Is the reasoning logical and are claims justified?',
      anchors: [
        'No reasoning, only assertions.',
        'Reasoning with clear logical gaps.',
        'Mostly logical, some unjustified jumps.',
        'Logical, claims justified.',
        'Rigorous: considers alternatives and justifies the choice.',
      ],
    },
    {
      key: 'tradeoffs',
      name: 'Trade-offs',
      skill: 'tradeoff_analysis',
      weight: 0.15,
      question: 'Does the candidate name trade-offs, costs or when an approach does not fit?',
      anchors: [
        'None.',
        'Mentions that trade-offs exist without naming any.',
        'Names one trade-off.',
        'Names relevant trade-offs and their effect.',
        'Weighs trade-offs and says when each option is the better choice.',
      ],
    },
    {
      key: 'clarity',
      name: 'Communication clarity',
      skill: 'technical_communication',
      weight: 0.15,
      question: 'Could an interviewer follow the explanation easily?',
      anchors: [
        'Impossible to follow.',
        'Hard to follow, jumps around.',
        'Understandable with effort.',
        'Clear and ordered.',
        'Very clear: structured, uses examples, right level of detail.',
      ],
    },
  ],
};
