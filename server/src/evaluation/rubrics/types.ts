/** A scoring rubric for one interview type. Lives in code (versioned with git, tested), not in the database. */
export type Criterion = {
  key: string;
  name: string;
  /** Skill this criterion trains, for progress tracking (M10). */
  skill: string;
  /** Share of the overall score; a rubric's weights sum to 1. */
  weight: number;
  /** The question the evaluator answers for this criterion. */
  question: string;
  /** What each score 0-4 means. Index = score. */
  anchors: readonly [string, string, string, string, string];
};

export type Rubric = {
  key: 'behavioral' | 'technical' | 'coding' | 'system_design';
  /** Bump when criteria, weights or anchors change, so scores stay comparable within a version. */
  version: number;
  title: string;
  criteria: readonly Criterion[];
  /** Extra guidance for the evaluator specific to this type. */
  notes: string;
};
