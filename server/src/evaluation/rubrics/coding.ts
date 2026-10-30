import type { Rubric } from './types';

export const coding: Rubric = {
  key: 'coding',
  version: 1,
  title: 'Coding answer (talked through)',
  notes:
    'The candidate talks through a solution instead of writing code. Judge the approach as described aloud; do not ' +
    'expect exact syntax.',
  criteria: [
    {
      key: 'problem_understanding',
      name: 'Problem understanding',
      skill: 'problem_understanding',
      weight: 0.15,
      question: 'Does the candidate restate the problem, clarify inputs and outputs, or ask about constraints?',
      anchors: [
        'Misunderstands the problem.',
        'Partial understanding, important parts missed.',
        'Understands the main problem, no clarification.',
        'Understands it and states inputs, outputs or constraints.',
        'Understands it fully and clarifies the ambiguous parts.',
      ],
    },
    {
      key: 'algorithm',
      name: 'Algorithm correctness',
      skill: 'algorithms',
      weight: 0.35,
      question: 'Would the described approach solve the problem correctly?',
      anchors: [
        'No workable approach.',
        'An approach that fails for common inputs.',
        'Works for the main case, with a flaw.',
        'Correct approach, described with minor gaps.',
        'Correct, efficient approach described step by step.',
      ],
    },
    {
      key: 'complexity',
      name: 'Complexity analysis',
      skill: 'complexity_analysis',
      weight: 0.2,
      question: 'Does the candidate state time and space complexity correctly?',
      anchors: [
        'Not mentioned.',
        'Mentioned but wrong.',
        'Time or space correct, the other missing.',
        'Time and space correct.',
        'Correct, and compares with alternatives.',
      ],
    },
    {
      key: 'edge_cases',
      name: 'Edge cases',
      skill: 'edge_cases',
      weight: 0.15,
      question: 'Does the candidate consider edge cases and how to test the solution?',
      anchors: [
        'None.',
        'A vague mention of testing.',
        'One relevant edge case.',
        'Several relevant edge cases.',
        'Edge cases plus how they would be tested.',
      ],
    },
    {
      key: 'code_quality',
      name: 'Code-quality reasoning',
      skill: 'code_quality',
      weight: 0.15,
      question: 'Does the candidate talk about readable structure, naming, or maintainability?',
      anchors: [
        'None.',
        'Generic statement ("clean code").',
        'One concrete point.',
        'Concrete points about structure or naming.',
        'Thoughtful design choices explained.',
      ],
    },
  ],
};
