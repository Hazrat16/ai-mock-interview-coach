// Runs queued evaluations in the background, one at a time (CPU-friendly). Pauses while an interview is
// going on, survives restarts (running work is re-queued at start), and waits instead of failing while Ollama
// is not running.
import type { InterviewConfig } from '@shared/schemas/interview';
import type { Db } from '../db/connection';
import {
  claimNextJob,
  completeEvaluation,
  failEvaluation,
  getEvaluation,
  interviewActive,
  type Job,
  requeueJob,
  resetRunningJobs,
} from '../db/repos/evaluations';
import { getTurns } from '../db/repos/sessions';
import { OllamaError, OllamaUnavailableError, type OllamaClient } from '../llm/ollamaClient';
import { StructuredOutputError } from '../llm/structured';
import { evaluate, type EvaluationInput } from './evaluator';
import { rubricByKey } from './rubrics';

export type RunnerDeps = {
  db: Db;
  llm: OllamaClient;
  /** Tried once if the evaluator model fails (smaller and faster). */
  fallbackModel: string;
  numThread?: number;
  log: (msg: string) => void;
  /** How often to look for work when idle, and to re-check a paused queue. */
  idleMs?: number;
  /** Wait after finding Ollama down before trying again. */
  unavailableMs?: number;
  timeoutMs?: number;
  isPaused?: () => boolean;
};

/** Everything the evaluator needs for one main question: its exchange, config and expected points. */
function loadInput(db: Db, evaluationId: string): { input: EvaluationInput; model: string } {
  const ev = getEvaluation(db, evaluationId);
  if (!ev) throw new Error(`evaluation ${evaluationId} not found`);
  const rubric = rubricByKey(ev.rubricKey);
  if (!rubric) throw new Error(`unknown rubric ${ev.rubricKey}`);
  const at = db
    .prepare(
      `SELECT t.id AS turn_id, t.session_id, t.question_id, s.config_snapshot_json
       FROM answers a JOIN turns t ON t.id = a.turn_id JOIN sessions s ON s.id = t.session_id WHERE a.id = ?`,
    )
    .get(ev.answerId) as {
    turn_id: string;
    session_id: string;
    question_id: string | null;
    config_snapshot_json: string;
  };
  const turns = getTurns(db, at.session_id);
  const exchange = turns
    .filter((t) => t.id === at.turn_id || t.parentTurnId === at.turn_id)
    .map((t) => ({ kind: t.kind, question: t.questionText, answer: t.answer?.transcript ?? null }));
  const expected = at.question_id
    ? (db.prepare('SELECT expected_points_json FROM questions WHERE id = ?').get(at.question_id) as
        { expected_points_json: string } | undefined)
    : undefined;
  return {
    model: ev.model,
    input: {
      rubric,
      config: JSON.parse(at.config_snapshot_json) as InterviewConfig,
      exchange,
      expectedPoints: expected ? (JSON.parse(expected.expected_points_json) as string[]) : [],
    },
  };
}

export class JobRunner {
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = true;
  private abort?: AbortController;

  constructor(private readonly deps: RunnerDeps) {}

  start() {
    const reset = resetRunningJobs(this.deps.db);
    if (reset) this.deps.log(`evaluations: ${reset} interrupted job(s) re-queued`);
    this.stopped = false;
    this.schedule(0);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.abort?.abort();
  }

  /** New work was queued: look now instead of at the next idle check. */
  wake() {
    if (!this.stopped && !this.running) this.schedule(0);
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.loop(), ms);
  }

  private async loop() {
    if (this.stopped || this.running) return;
    let next = this.deps.idleMs ?? 3000;
    try {
      const outcome = await this.runOnce();
      if (outcome === 'done') next = 0;
      if (outcome === 'unavailable') next = this.deps.unavailableMs ?? 30_000;
    } catch (err) {
      this.deps.log(`evaluations: runner error: ${(err as Error).message}`);
    }
    if (!this.stopped) this.schedule(next);
  }

  /** Processes at most one job. 'idle': nothing to do or paused; 'unavailable': Ollama down, job re-queued. */
  async runOnce(): Promise<'idle' | 'done' | 'unavailable'> {
    const paused = this.deps.isPaused ? this.deps.isPaused() : interviewActive(this.deps.db);
    if (paused) return 'idle';
    const job = claimNextJob(this.deps.db);
    if (!job) return 'idle';
    this.running = true;
    this.abort = new AbortController();
    try {
      return await this.process(job);
    } finally {
      this.running = false;
      this.abort = undefined;
    }
  }

  private async process(job: Job): Promise<'done' | 'unavailable'> {
    const started = performance.now();
    let loaded: ReturnType<typeof loadInput>;
    try {
      loaded = loadInput(this.deps.db, job.evaluationId);
    } catch (err) {
      failEvaluation(this.deps.db, job, (err as Error).message, 0);
      return 'done';
    }
    const { input, model } = loaded;
    const models = [...new Set([model, this.deps.fallbackModel])];
    let lastError = '';
    for (const m of models) {
      try {
        const r = await evaluate(this.deps.llm, input, {
          model: m,
          numThread: this.deps.numThread,
          timeoutMs: this.deps.timeoutMs,
          signal: this.abort?.signal,
        });
        completeEvaluation(this.deps.db, job, {
          model: m,
          overall: r.overall,
          result: r.result,
          unsupported: r.unsupported,
          durationMs: r.ms,
          skills: Object.fromEntries(input.rubric.criteria.map((c) => [c.key, c.skill])),
        });
        this.deps.log(`evaluation done with ${m} in ${Math.round(r.ms / 1000)} s (score ${r.overall})`);
        return 'done';
      } catch (err) {
        if (err instanceof OllamaUnavailableError || (err as Error).name === 'AbortError') {
          // Ollama is not running (or the app is stopping): not the answer's fault, try again later.
          requeueJob(this.deps.db, job, err instanceof OllamaUnavailableError ? err.message : 'interrupted');
          return 'unavailable';
        }
        if (!(err instanceof OllamaError || err instanceof StructuredOutputError)) throw err;
        lastError = `${m}: ${err.message}`;
        this.deps.log(`evaluation with ${m} failed: ${err.message}`);
      }
    }
    failEvaluation(this.deps.db, job, lastError, Math.round(performance.now() - started));
    return 'done';
  }
}
