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
import { addCompanyQuestions, companyCandidates, companyNoteIds, questionProvenance } from '../db/repos/companies';
import { practicedSkills } from '../db/repos/coverage';
import { getDocument, linkSessionDocument, sessionDocumentContext } from '../db/repos/documents';
import { findCandidates, getQuestion, idsForTexts, insertQuestions, recentlyAskedIds } from '../db/repos/questions';
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
  updateTurnQuestion,
} from '../db/repos/sessions';
import { conflict, notFound } from '../errors';
import type { OllamaClient } from '../llm/ollamaClient';
import { isClarificationRequest, rephrase } from './clarify';
import { chooseFollowUp, decide, warmUp } from './followUp';
import { generateFromDocument, generateQuestions } from './generator';
import { planAssessment } from './assessment';
import { planQuestions, seededRandom, shuffle } from './planner';
import {
  ACKS,
  CLARIFY_REPEATED,
  CLARIFY_REPHRASED,
  CLOSING,
  PROBES_REWORDED,
  intro,
  lead,
  pick,
  probesFor,
} from './phrases';

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
  documentId?: string;
  company?: string;
  assessment?: boolean;
};

const OPEN: SessionStatus[] = ['planned', 'in_progress', 'paused'];

/** After this many rewordings of one question, the reply counts as an answer (no endless loop on a misdetection). */
const MAX_CLARIFICATIONS = 2;

export class InterviewEngine {
  /** Rewordings per turn. In memory: after a restart the limit simply starts over. */
  private readonly clarifications = new Map<string, number>();

  constructor(private readonly deps: EngineDeps) {}

  private get db() {
    return this.deps.db;
  }

  async create(input: CreateInput): Promise<CreateSessionResponse> {
    if (input.documentId) return this.createFromDocument(input.config, input.documentId);
    if (input.company) return this.createForCompany({ ...input, company: input.company });
    const { config } = input;
    const seed = input.seed ?? randomInt(2 ** 31);
    const recentIds = recentlyAskedIds(this.db, this.deps.recentSessions ?? 3);
    const plan = () =>
      input.assessment
        ? planAssessment(findCandidates(this.db, config), {
            count: config.questionCount,
            seed,
            family: config.jobFamily,
            practiced: practicedSkills(this.db),
          })
        : planQuestions(findCandidates(this.db, config), {
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
      mode: input.assessment ? 'assessment' : 'random',
      interviewerModel: s.interviewerModel,
    });
    if (this.deps.warmUp) void warmUp(this.deps.llm, s.interviewerModel, this.deps.numThread);
    return { status: 'created', sessionId, questionCount: p.questionIds.length, generated };
  }

  /** A job-description or resume interview: every question is written from the document's summary. */
  private async createFromDocument(config: InterviewConfig, documentId: string): Promise<CreateSessionResponse> {
    const doc = getDocument(this.db, documentId);
    if (!doc) throw notFound('Document');
    if (!doc.summary) throw conflict('This document has no summary yet. Open Documents and summarize it again.');
    const s = this.deps.settings();
    const questions = await generateFromDocument(
      this.deps.llm,
      { model: s.evaluatorModel, numThread: this.deps.numThread },
      config,
      { kind: doc.kind, summary: doc.summary },
      config.questionCount,
    );
    if (questions.length === 0) throw conflict('The model wrote no questions. Try again.');
    insertQuestions(
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
        source: 'user',
        provenance: 'generated',
      })),
    );
    const texts = questions.map((q) => q.text);
    const questionIds = [...new Set(idsForTexts(this.db, texts))];
    const sessionId = insertSession(this.db, {
      config,
      plan: { seed: 0, questionIds },
      mode: doc.kind === 'resume' ? 'resume' : 'jd',
      interviewerModel: s.interviewerModel,
    });
    linkSessionDocument(this.db, sessionId, doc.id);
    if (this.deps.warmUp) void warmUp(this.deps.llm, s.interviewerModel, this.deps.numThread);
    return { status: 'created', sessionId, questionCount: questionIds.length, generated: questions.length };
  }

  /** A company interview: your questions first, then predictions; offers to predict more when there are too few. */
  private async createForCompany(input: CreateInput & { company: string }): Promise<CreateSessionResponse> {
    const { config, company } = input;
    const seed = input.seed ?? randomInt(2 ** 31);
    const pick = () => {
      const random = seededRandom(seed);
      const all = companyCandidates(this.db, company, config.interviewType).sort((a, b) =>
        a.text.localeCompare(b.text),
      );
      const yours = shuffle(
        all.filter((q) => q.verified),
        random,
      );
      const predicted = shuffle(
        all.filter((q) => !q.verified),
        random,
      );
      return [...yours, ...predicted].slice(0, config.questionCount).map((q) => q.id);
    };
    let questionIds = pick();
    let generated = 0;
    if (questionIds.length < config.questionCount) {
      if (input.onShortfall === 'ask') {
        return { status: 'needs_decision', available: questionIds.length, requested: config.questionCount };
      }
      if (input.onShortfall === 'generate') {
        generated = (await this.predictForCompany(company, config, config.questionCount - questionIds.length)).added;
        questionIds = pick();
      }
      if (questionIds.length === 0) {
        throw conflict(
          `No ${config.interviewType.replace('_', ' ')} questions for ${company} yet. Add yours on the Companies page, or predict some from your notes.`,
        );
      }
    }
    const s = this.deps.settings();
    const sessionId = insertSession(this.db, {
      config,
      plan: { seed, questionIds },
      mode: 'company',
      interviewerModel: s.interviewerModel,
    });
    for (const id of companyNoteIds(this.db, company)) linkSessionDocument(this.db, sessionId, id);
    if (this.deps.warmUp) void warmUp(this.deps.llm, s.interviewerModel, this.deps.numThread);
    return { status: 'created', sessionId, questionCount: questionIds.length, generated };
  }

  /**
   * Predicts questions a company may ask, written only from your notes about it (never from what the model
   * believes about the company). Always stored as predictions.
   */
  async predictForCompany(
    company: string,
    config: Pick<InterviewConfig, 'interviewType' | 'jobTitle' | 'level' | 'difficulty' | 'customInstructions'>,
    count: number,
  ) {
    const notes = companyNoteIds(this.db, company).map((id) => getDocument(this.db, id)!.summary!);
    if (!notes.length) {
      throw conflict(`Add your notes about ${company} first: predictions are written only from your notes.`);
    }
    const questions = await generateFromDocument(
      this.deps.llm,
      { model: this.deps.settings().evaluatorModel, numThread: this.deps.numThread },
      { ...config, jobFamily: 'other', questionCount: count, thinkingTimeSec: 0, followUpLimit: 0 },
      { kind: 'company_notes', summary: notes.join('\n\n').slice(0, 2400) },
      count,
    );
    return addCompanyQuestions(
      this.db,
      company,
      config.interviewType,
      questions.map((q) => ({
        text: q.text,
        difficulty: q.difficulty,
        skills: q.skills,
        expectedPoints: q.expected_points,
      })),
    );
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
    const asked = this.clarifications.get(turnId) ?? 0;
    if (asked < MAX_CLARIFICATIONS && isClarificationRequest(body.transcript)) {
      this.clarifications.set(turnId, asked + 1);
      const main = turn.parentTurnId ? turns.find((t) => t.id === turn.parentTurnId) : undefined;
      return this.askAgain(session, turn, body.transcript, main?.questionText);
    }
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
          document: sessionDocumentContext(this.db, session.id),
        },
      );
      this.deps.log?.(error ? `follow-up decision failed after ${ms} ms: ${error}` : `follow-up decision in ${ms} ms`);
      if (decision) {
        updateTurnInsight(this.db, main.id, decision.summary, decision.quality_signal);
        followUp = chooseFollowUp(
          decision,
          [main.questionText, ...thread.map((t) => t.questionText)],
          probesFor(session.config.interviewType),
        );
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

  /** The candidate asked what the question means: the same turn stays open, asked again in simpler words. */
  private async askAgain(
    session: SessionRow,
    turn: TurnRow,
    request: string,
    mainQuestion?: string,
  ): Promise<TurnResult> {
    const reworded =
      PROBES_REWORDED[turn.questionText] ??
      (await rephrase(
        this.deps.llm,
        {
          model: session.interviewerModel,
          numThread: this.deps.numThread,
          timeoutMs: this.deps.decisionTimeoutMs ?? 45_000,
        },
        { config: session.config, question: turn.questionText, mainQuestion, request },
      ));
    this.deps.log?.(reworded ? 'question reworded on request' : 'question repeated on request (rewording failed)');
    if (reworded) updateTurnQuestion(this.db, turn.id, reworded);
    return {
      ack: reworded ? CLARIFY_REPHRASED : CLARIFY_REPEATED,
      lead: '',
      next: this.view(session, getTurns(this.db, session.id), turn.id),
      closing: null,
    };
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
          ...(t.kind === 'main' && t.questionId ? provenanceOf(this.db, t.questionId) : {}),
        };
      }
    }
    throw notFound('Question');
  }
}

/** A company question's label (R23), as a turn view field; nothing for other questions. */
function provenanceOf(db: Db, questionId: string) {
  const provenance = questionProvenance(db, questionId);
  return provenance ? { provenance } : {};
}
