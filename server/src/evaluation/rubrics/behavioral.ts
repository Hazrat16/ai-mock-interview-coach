import type { Rubric } from './types';

// Used for behavioral and HR interviews. Anchors tested with qwen3.5:4b in M3 (docs/benchmarks/2026-10-29-llm-bench.md).
export const behavioral: Rubric = {
  key: 'behavioral',
  version: 1,
  title: 'Behavioral / HR answer',
  notes: 'Behavioral answers are judged as stories: what happened, what the candidate did, and what came of it.',
  criteria: [
    {
      key: 'relevance',
      name: 'Relevance',
      skill: 'answering_the_question',
      weight: 0.2,
      question: 'Does the answer address the question that was asked?',
      anchors: [
        'Unrelated, or no answer.',
        'Loosely related, mostly off-topic.',
        'Related, but drifts or answers a different question.',
        'Clearly answers the question, with minor detours.',
        'Directly and fully answers the question.',
      ],
    },
    {
      key: 'star_structure',
      name: 'Structure (STAR)',
      skill: 'structured_storytelling',
      weight: 0.2,
      question: 'Is there a clear Situation, Task, Action and Result?',
      anchors: [
        'No structure.',
        'Only one of the four elements.',
        'Two or three elements, hard to follow.',
        'All four elements present, some thin.',
        'All four elements clear, in a logical order, concise.',
      ],
    },
    {
      key: 'personal_contribution',
      name: 'Personal contribution',
      skill: 'ownership',
      weight: 0.25,
      question: "Is the candidate's own role and decision-making clear (I, not only we)?",
      anchors: [
        'No personal role.',
        'Vague personal role.',
        'Some personal actions, mostly team actions.',
        'Clear personal actions with some reasoning.',
        'Specific personal actions with explicit reasoning and ownership.',
      ],
    },
    {
      key: 'results_impact',
      name: 'Results and impact',
      skill: 'impact',
      weight: 0.2,
      question: 'Are outcomes stated, ideally measurable, and linked to the actions?',
      anchors: [
        'No result.',
        'Vague result ("it went fine").',
        'Concrete result, not linked to the actions.',
        'Concrete result linked to the actions.',
        'Measurable result linked to the actions, including trade-offs or what changed afterwards.',
      ],
    },
    {
      key: 'reflection',
      name: 'Reflection',
      skill: 'self_reflection',
      weight: 0.15,
      question: 'Does the candidate show what they learned or would do differently?',
      anchors: [
        'None.',
        'A generic statement.',
        'A specific lesson, not applied.',
        'A specific lesson, applied later.',
        'An insightful lesson with evidence of applying it.',
      ],
    },
  ],
};
