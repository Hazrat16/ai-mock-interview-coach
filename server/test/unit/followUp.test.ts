import { describe, expect, it } from 'vitest';
import type { InterviewConfig } from '@shared/schemas/interview';
import {
  acceptFollowUp,
  buildMessages,
  chooseFollowUp,
  type Decision,
  decisionSchema,
  similarity,
} from '../../src/interview/followUp';
import { PROBES } from '../../src/interview/phrases';

const probes = PROBES.experience; // the question below is behavioral

const main = 'Tell me about a time you disagreed with a teammate about a technical decision. What happened?';
const decision = (follow_up: string | null, action: Decision['action'] = 'follow_up'): Decision => ({
  action,
  follow_up,
  summary: 's',
  quality_signal: 'ok',
});

describe('similarity', () => {
  it('is high for a rephrased main question and low for a real follow-up', () => {
    const rephrased = 'Can you give a specific example of when you disagreed with a teammate on a technical decision?';
    const probing = 'How did you make sure your teammate felt heard while you compared the prototypes?';
    expect(similarity(main, rephrased)).toMatchObject({ common: 4 });
    expect(similarity(main, rephrased).overlap).toBeGreaterThanOrEqual(0.6);
    expect(similarity(main, probing).common).toBeLessThanOrEqual(1);
  });
});

describe('acceptFollowUp', () => {
  it('accepts a new, specific question', () => {
    const q = 'How did you make sure your teammate felt heard while you compared the prototypes?';
    expect(acceptFollowUp(decision(q), [main])).toBe(q);
  });

  it('rejects a follow-up that repeats the main question (granite did this in M3)', () => {
    const repeat = 'Can you give a specific example of when you disagreed with a teammate on a technical decision?';
    expect(acceptFollowUp(decision(repeat), [main])).toBeNull();
  });

  it('accepts a short follow-up that reuses a couple of key terms', () => {
    const q = 'What was the technical decision exactly?';
    expect(acceptFollowUp(decision(q), [main])).toBe(q);
  });

  it('rejects a repeat of an earlier follow-up', () => {
    const earlier = 'How did your mentor help you compare the two prototypes?';
    const again = 'Can you tell me how your mentor helped compare the two prototypes?';
    expect(acceptFollowUp(decision(again), [main, earlier])).toBeNull();
  });

  it('rejects action "next", empty and overlong follow-ups', () => {
    expect(acceptFollowUp(decision('Why that one?', 'next'), [main])).toBeNull();
    expect(acceptFollowUp(decision(null), [main])).toBeNull();
    expect(acceptFollowUp(decision('   '), [main])).toBeNull();
    expect(acceptFollowUp(decision('x'.repeat(401)), [main])).toBeNull();
  });
});

describe('buildMessages', () => {
  const config: InterviewConfig = {
    jobTitle: 'Backend Engineer',
    jobFamily: 'software_engineering',
    level: 'junior',
    interviewType: 'behavioral',
    difficulty: 'medium',
    questionCount: 3,
    thinkingTimeSec: 10,
    followUpLimit: 1,
    customInstructions: 'Focus on teamwork.',
  };

  it('includes the setup, covered topics and the answer, and clips very long answers', () => {
    const [system, user] = buildMessages({
      config,
      coveredTopics: ['Chose PostgreSQL for a project.'],
      mainQuestion: main,
      thread: [],
      answer: 'word '.repeat(2000),
    });
    expect(system!.role).toBe('system');
    expect(user!.content).toContain('role: Backend Engineer, level: junior');
    expect(user!.content).toContain('Focus on teamwork.');
    expect(user!.content).toContain('1. Chose PostgreSQL for a project.');
    expect(user!.content).toContain(`Main question: ${main}`);
    expect(user!.content).toContain('[...]');
    expect(user!.content.length).toBeLessThan(3200);
  });
});

describe('chooseFollowUp', () => {
  const rephrased = 'Can you give a specific example of when you disagreed with a teammate about a technical decision?';
  const weak = (follow_up: string | null): Decision => ({ ...decision(follow_up), quality_signal: 'weak' });

  it("uses the model's own follow-up when it is new", () => {
    const own = 'What did you do when your teammate still disagreed after the benchmark?';
    expect(chooseFollowUp(weak(own), [main], probes)).toBe(own);
  });

  it('asks a fixed probe for a weak answer when the model only rephrased the main question', () => {
    expect(chooseFollowUp(weak(rephrased), [main], probes)).toBe(probes[0]);
    // The second probe if the first was already asked on this question; none after that.
    expect(chooseFollowUp(weak(rephrased), [main, probes[0]!], probes)).toBe(probes[1]);
    expect(chooseFollowUp(weak(rephrased), [main, ...probes], probes)).toBeNull();
  });

  it('does not probe when the answer was not weak, or the model chose "next"', () => {
    expect(chooseFollowUp(decision(rephrased), [main], probes)).toBeNull(); // quality ok
    expect(chooseFollowUp({ ...weak(null), action: 'next' }, [main], probes)).toBeNull();
  });
});

describe('decision schema', () => {
  it('asks for the judgment before the decision (field order is generation order)', () => {
    expect(Object.keys(decisionSchema.shape)).toEqual(['summary', 'quality_signal', 'action', 'follow_up']);
  });
});
