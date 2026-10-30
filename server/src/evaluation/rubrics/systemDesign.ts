import type { Rubric } from './types';

export const systemDesign: Rubric = {
  key: 'system_design',
  version: 1,
  title: 'System design answer',
  notes:
    'A spoken system design answer is a short version of a design session. Judge whether the important parts are ' +
    'covered in a sensible order for the stated level, not whether every component is named.',
  criteria: [
    {
      key: 'requirements',
      name: 'Requirements',
      skill: 'requirements_gathering',
      weight: 0.2,
      question: 'Does the candidate establish functional and non-functional requirements and scale?',
      anchors: [
        'None; jumps straight into components.',
        'Mentions requirements vaguely.',
        'Functional requirements only.',
        'Functional and non-functional requirements, with rough scale.',
        'Clear requirements, scale estimates, and what is out of scope.',
      ],
    },
    {
      key: 'architecture',
      name: 'Architecture',
      skill: 'architecture',
      weight: 0.25,
      question: 'Is there a coherent high-level design with clear components and data flow?',
      anchors: [
        'No coherent design.',
        'A few components without how they connect.',
        'A basic design with gaps in the data flow.',
        'Coherent components and data flow.',
        'Coherent and well-justified, with a clear request path.',
      ],
    },
    {
      key: 'data_storage',
      name: 'Data and storage',
      skill: 'data_modeling',
      weight: 0.2,
      question: 'Are the data model and storage choices sensible and justified?',
      anchors: [
        'Not discussed.',
        'A storage choice without reasons.',
        'Reasonable choice, little justification.',
        'Justified choice with a basic data model.',
        'Justified choice, data model, and access patterns.',
      ],
    },
    {
      key: 'scalability',
      name: 'Scalability and reliability',
      skill: 'scalability',
      weight: 0.2,
      question: 'Does the design address growth, bottlenecks and failures?',
      anchors: [
        'Not discussed.',
        'Buzzwords only ("just scale it").',
        'One relevant technique (caching, replication, ...).',
        'Several techniques tied to real bottlenecks.',
        'Bottlenecks identified, techniques and failure handling explained.',
      ],
    },
    {
      key: 'tradeoffs',
      name: 'Trade-offs',
      skill: 'tradeoff_analysis',
      weight: 0.15,
      question: 'Does the candidate discuss trade-offs of the main decisions?',
      anchors: [
        'None.',
        'Mentions that trade-offs exist.',
        'One trade-off named.',
        'Relevant trade-offs with their effects.',
        'Trade-offs weighed with alternatives and a reasoned choice.',
      ],
    },
  ],
};
