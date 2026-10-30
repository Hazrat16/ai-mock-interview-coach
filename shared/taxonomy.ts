// Skills an interview can cover, per job family (M15, R24). Keys are the question bank's skill tags
// (seed/questions/*.json), so coverage is counted from the questions you answered. A skill with no bank questions
// yet is still listed: the coverage view says so instead of hiding the gap.
import type { InterviewConfig } from './schemas/interview';

export type Skill = { key: string; label: string };
export type SkillGroup = { name: string; skills: Skill[] };

const s = (key: string, label: string): Skill => ({ key, label });

/** For every job family: how you work with people, judged in behavioral and HR interviews. */
const WORKING_WITH_PEOPLE: SkillGroup = {
  name: 'Working with people',
  skills: [
    s('communication', 'Communication'),
    s('collaboration', 'Collaboration'),
    s('influence', 'Influence and persuasion'),
    s('mentoring', 'Mentoring'),
  ],
};
const HOW_YOU_WORK: SkillGroup = {
  name: 'How you work',
  skills: [
    s('ownership', 'Ownership'),
    s('accountability', 'Accountability'),
    s('initiative', 'Initiative'),
    s('prioritization', 'Prioritization'),
    s('judgment', 'Judgment'),
    s('problem_solving', 'Problem solving'),
    s('delivery', 'Delivering results'),
    s('adaptability', 'Adaptability'),
    s('resilience', 'Resilience'),
    s('learning', 'Learning'),
    s('self_awareness', 'Self-awareness'),
    s('motivation', 'Motivation'),
  ],
};

export const TAXONOMY: Record<InterviewConfig['jobFamily'], SkillGroup[]> = {
  software_engineering: [
    {
      name: 'Coding',
      skills: [
        s('algorithms', 'Algorithms'),
        s('data_structures', 'Data structures'),
        s('complexity', 'Complexity analysis'),
        s('dynamic_programming', 'Dynamic programming'),
        s('graphs', 'Graphs'),
      ],
    },
    {
      name: 'Engineering',
      skills: [
        s('databases', 'Databases'),
        s('api_design', 'API design'),
        s('concurrency', 'Concurrency'),
        s('web_fundamentals', 'Web fundamentals'),
        s('networking', 'Networking'),
        s('operating_systems', 'Operating systems'),
        s('security', 'Security'),
        s('testing', 'Testing'),
        s('debugging', 'Debugging'),
        s('performance', 'Performance'),
        s('observability', 'Observability'),
        s('infrastructure', 'Infrastructure'),
        s('tooling', 'Tooling'),
      ],
    },
    {
      name: 'System design',
      skills: [
        s('system_design', 'System design'),
        s('scalability', 'Scalability'),
        s('distributed_systems', 'Distributed systems'),
        s('messaging', 'Messaging and queues'),
        s('trade_offs', 'Trade-offs'),
      ],
    },
    WORKING_WITH_PEOPLE,
    HOW_YOU_WORK,
  ],
  data: [
    {
      name: 'Data',
      skills: [
        s('machine_learning', 'Machine learning'),
        s('data_cleaning', 'Data cleaning'),
        s('data_pipelines', 'Data pipelines'),
        s('databases', 'Databases and SQL'),
        s('statistics', 'Statistics'),
        s('trade_offs', 'Trade-offs'),
      ],
    },
    WORKING_WITH_PEOPLE,
    HOW_YOU_WORK,
  ],
  product: [
    {
      name: 'Product',
      skills: [s('product_sense', 'Product sense'), s('prioritization', 'Prioritization'), s('metrics', 'Metrics')],
    },
    WORKING_WITH_PEOPLE,
    HOW_YOU_WORK,
  ],
  design: [
    {
      name: 'Design',
      skills: [
        s('user_research', 'User research'),
        s('design_critique', 'Design critique'),
        s('accessibility', 'Accessibility'),
      ],
    },
    WORKING_WITH_PEOPLE,
    HOW_YOU_WORK,
  ],
  other: [WORKING_WITH_PEOPLE, HOW_YOU_WORK],
};

/** Every skill key of a family, once. */
export const familySkills = (family: InterviewConfig['jobFamily']) => [
  ...new Set(TAXONOMY[family].flatMap((g) => g.skills.map((x) => x.key))),
];
