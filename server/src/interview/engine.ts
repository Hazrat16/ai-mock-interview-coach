import { randomInt } from 'node:crypto';
import type {
  AnswerRequest,
  CreateSessionResponse,
  InterviewConfig,
  SessionDetail,
  SessionSummary,
  TurnResult,
  TurnView,
} from '@shared/schemas/interview';
import type { Settings } from '@shared/schemas/settings';
import { type Db, transaction } from '../db/connection';
import { findCandidates, getQuestion, insertQuestions, recentlyAskedIds } from '../db/repos/questions';
import {
  type SessionRow,
  type SessionStatus,
  type TurnRow,
  deleteSession,
  getSession,
  getTurns,
  insertAnswer,
  insertSession,
  insertTurn,
  listSessions,
  setStatus,
  updateTurnInsight,
} from '../db/repos/sessions';
import { conflict, notFound } from '../errors';
import type { OllamaClient } from '../llm/ollamaClient';
import { chooseFollowUp, decide, warmUp } from './followUp';
import { generateQuestions } from './generator';
import { planQuestions } from './planner';
import { ACKS, CLOSING, intro, lead, pick } from './phrases';

export type EngineDeps = {
  db: Db;
  llm: OllamaClient;
  settings: () => Settings;
  numThread?: number;
  /** Max wait for the follow-up decision before moving on without it. */
  decisionTimeoutMs?: number;
  /** Questions asked in this many recent sessions are used only when nothing fresher is left. */
  recentSessions?: number;
  /** Load the interviewer model when a session is created (off in tests). */
  warmUp?: boolean;
  log?: (msg: string) => void;
  /** Called when a session ends with at least one answer (queues its evaluation). */
  onCompleted?: (sessionId: string) => void;
};

type CreateInput = {
  config: InterviewConfig;
  seed?: number;
  onShortfall: 'ask' | 'generate' | 'reduce';
};

const OPEN: SessionStatus[] = ['planned', 'in_progress', 'paused'];

export class InterviewEngine {
  constructor(private readonly deps: EngineDeps) {}

  private get db() {
    return this.deps.db;
  }

  async create(input: CreateInput): Promise<CreateSessionResponse> {
    const { config } = input;
    const seed = input.seed ?? randomInt(2 ** 31);
    const recentIds = recentlyAskedIds(this.db, this.deps.recentSessions ?? 3);
    const plan = () =>
      planQuestions(findCandidates(this.db, config), {
        count: config.questionCount,
        difficulty: config.difficulty,
        seed,
        recentIds,
      });

    let p = plan();
    let generated = 0;
    if (p.shortfall > 0) {
      if (input.onShortfall === 'ask') {
        return { status: 'needs_decision', available: p.questionIds.length, requested: config.questionCount };
      }
      if (input.onShortfall === 'generate') {
        generated = await this.generate(config, p.shortfall);
        p = plan();
      }
      if (p.questionIds.length === 0) throw conflict('No questions match these settings. Try generating some.');
    }

    const s = this.deps.settings();
    const sessionId = insertSession(this.db, {
      config,
      plan: { seed, questionIds: p.questionIds },
      mode: 'random',
      interviewerModel: s.interviewerModel,
    });
    if (this.deps.warmUp) void warmUp(this.deps.llm, s.interviewerModel, this.deps.numThread);
    return { status: 'created', sessionId, questionCount: p.questionIds.length, generated };
  }

  private async generate(config: InterviewConfig, count: number): Promise<number> {
    const avoid = findCandidates(this.db, config).map((q) => q.text);
    const questions = await generateQuestions(
      this.deps.llm,
      { model: this.deps.settings().evaluatorModel, numThread: this.deps.numThread },
      config,
      count,
      avoid,
    );
    return insertQuestions(
      this.db,
      questions.map((q) => ({
        text: q.text,
        interviewType: config.interviewType,
        jobFamily: config.jobFamily,
        levelMin: config.level,
        levelMax: config.level,
        difficulty: q.difficulty,
        skills: q.skills,
        expectedPoints: q.expected_points,
        source: 'generated',
        provenance: 'generated',
      })),
    );
  }

  /** Starts a planned session, or resumes one in progress. */
  start(sessionId: string): SessionDetail {
    const session = this.session(sessionId);
    if (!OPEN.includes(session.status)) throw conflict(`This interview is already ${session.status}.`);
    transaction(this.db, () => {
      if (session.status !== 'in_progress') setStatus(this.db, session.id, 'in_progress');
      const turns = getTurns(this.db, session.id);
      // First start, or the server stopped after saving an answer but before asking the next question.
      if (turns.length === 0 || turns.at(-1)!.answer) this.advance(session, turns);
    });
    return this.detail(sessionId);
  }

  async answer(sessionId: string, turnId: string, body: AnswerRequest): Promise<TurnResult> {
    const session = this.session(sessionId);
    const turns = getTurns(this.db, sessionId);
    const turn = this.openTurn(session, turns, turnId);
    try {
      insertAnswer(this.db, { turnId, ...body });
    } catch (err) {
      // Two submits raced past openTurn(); the UNIQUE(turn_id) constraint stops the second.
      if (/UNIQUE/.test((err as Error).message)) throw conflict('This question was already answered.');
      throw err;
    }

    const main = turn.kind === 'main' ? turn : turns.find((t) => t.id === turn.parentTurnId)!;
    const thread = turns.filter((t) => t.parentTurnId === main.id);
    let followUp: string | null = null;

    // The decision is only worth its 5-20 s when another follow-up is still allowed.
    if (thread.length < session.config.followUpLimit) {
      const { decision, error, ms } = await decide(
        this.deps.llm,
        {
          model: session.interviewerModel,
          numThread: this.deps.numThread,
          timeoutMs: this.deps.decisionTimeoutMs ?? 45_000,
        },
        {
          config: session.config,
          coveredTopics: turns
            .filter((t) => t.kind === 'main' && t.seq < main.seq)
            .map((t) => t.summary ?? t.questionText),
          mainQuestion: main.questionText,
          thread: thread
            .filter((t) => t.id !== turn.id && t.answer)
            .map((t) => ({ question: t.questionText, answer: t.answer!.transcript })),
          answer: body.transcript,
        },
      );
      this.deps.log?.(error ? `follow-up decision failed after ${ms} ms: ${error}` : `follow-up decision in ${ms} ms`);
      if (decision) {
        updateTurnInsight(this.db, main.id, decision.summary, decision.quality_signal);
        followUp = chooseFollowUp(decision, [main.questionText, ...thread.map((t) => t.questionText)]);
      }
    }

    const ack = pick(ACKS, turn.seq);
    const updated = getTurns(this.db, sessionId);
    if (followUp) {
      const id = insertTurn(this.db, {
        sessionId,
        seq: turn.seq + 1,
        kind: 'follow_up',
        parentTurnId: main.id,
        questionText: followUp,
      });
      return { ack, lead: '', next: this.view(session, getTurns(this.db, sessionId), id), closing: null };
    }
    return { ack, ...this.advance(session, updated) };
  }

  /** Leaves the open question unanswered and moves to the next main question. */
  skip(sessionId: string, turnId: string): TurnResult {
    const session = this.session(sessionId);
    const turns = getTurns(this.db, sessionId);
    this.openTurn(session, turns, turnId);
    const next = this.advance(session, turns);
    return { ack: next.next ? 'No problem.' : '', ...next };
  }

  /** Ends early. Completed if at least one answer was given, abandoned otherwise. */
  end(sessionId: string): SessionDetail {
    const session = this.session(sessionId);
    if (OPEN.includes(session.status)) {
      const answered = getTurns(this.db, sessionId).some((t) => t.answer);
      setStatus(this.db, sessionId, answered ? 'completed' : 'abandoned');
      if (answered) this.deps.onCompleted?.(sessionId);
    }
    return this.detail(sessionId);
  }

  detail(sessionId: string): SessionDetail {
    const session = this.session(sessionId);
    const turns = getTurns(this.db, sessionId);
    const last = turns.at(-1);
    const open = session.status === 'in_progress' && last && !last.answer;
    return {
      id: session.id,
      status: session.status,
      config: session.config,
      createdAt: session.createdAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      intro: intro(session.config, session.plan.questionIds.length),
      turns: turns.map((t) => ({
        ...this.view(session, turns, t.id),
        answer: t.answer && { transcript: t.answer.transcript, createdAt: t.answer.createdAt },
      })),
      current: open ? this.view(session, turns, last.id) : null,
    };
  }

  list(status?: SessionStatus): SessionSummary[] {
    return listSessions(this.db, status).map((s) => ({
      id: s.id,
      status: s.status,
      jobTitle: s.config.jobTitle,
      interviewType: s.config.interviewType,
      createdAt: s.createdAt,
      answered: s.answered,
      totalQuestions: s.plan.questionIds.length,
    }));
  }

  delete(sessionId: string) {
    if (!deleteSession(this.db, sessionId)) throw notFound('Interview');
  }

  // ---- helpers ----

  private session(id: string): SessionRow {
    const s = getSession(this.db, id);
    if (!s) throw notFound('Interview');
    return s;
  }

  /** The turn must be the latest one and still unanswered: protects against double submits. */
  private openTurn(session: SessionRow, turns: TurnRow[], turnId: string): TurnRow {
    if (session.status !== 'in_progress') throw conflict(`This interview is ${session.status}.`);
    const turn = turns.find((t) => t.id === turnId);
    if (!turn) throw notFound('Question');
    if (turn !== turns.at(-1) || turn.answer) throw conflict('This question was already answered or skipped.');
    return turn;
  }

  /** Asks the next planned main question, or completes the session when none are left. */
  private advance(session: SessionRow, turns: TurnRow[]): Omit<TurnResult, 'ack'> {
    const asked = turns.filter((t) => t.kind === 'main').length;
    const total = session.plan.questionIds.length;
    if (asked >= total) {
      setStatus(this.db, session.id, 'completed');
      this.deps.onCompleted?.(session.id);
      return { lead: '', next: null, closing: CLOSING };
    }
    const question = getQuestion(this.db, session.plan.questionIds[asked]!);
    const id = insertTurn(this.db, {
      sessionId: session.id,
      seq: (turns.at(-1)?.seq ?? 0) + 1,
      kind: 'main',
      questionId: question?.id,
      // A bank question deleted after planning should not break the interview.
      questionText: question?.text ?? 'Tell me about a recent piece of work you are proud of.',
      difficulty: question?.difficulty,
    });
    return {
      lead: asked === 0 ? '' : lead(asked + 1, total),
      next: this.view(session, getTurns(this.db, session.id), id),
      closing: null,
    };
  }

  private view(session: SessionRow, turns: TurnRow[], turnId: string): TurnView {
    let questionNumber = 0;
    for (const t of turns) {
      if (t.kind === 'main') questionNumber++;
      if (t.id === turnId) {
        return {
          id: t.id,
          seq: t.seq,
          kind: t.kind,
          text: t.questionText,
          questionNumber,
          totalQuestions: session.plan.questionIds.length,
        };
      }
    }
    throw notFound('Question');
  }
}
