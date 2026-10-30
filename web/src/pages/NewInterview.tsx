import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import {
  type CreateSessionResponse,
  createSessionResponseSchema,
  DIFFICULTIES,
  INTERVIEW_TYPES,
  type InterviewConfig,
  interviewConfigSchema,
  JOB_FAMILIES,
  LEVELS,
  type SessionSummary,
  sessionSummarySchema,
} from '@shared/schemas/interview';
import { type DocumentView, documentViewSchema } from '@shared/schemas/documents';
import { settingsSchema } from '@shared/schemas/settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getJson, sendJson } from '@/lib/api';
import { DIFFICULTY_LABELS, INTERVIEW_TYPE_LABELS, JOB_FAMILY_LABELS, LEVEL_LABELS } from '@/lib/labels';
import { fieldClass } from '@/lib/styles';

const STORAGE_KEY = 'interview-coach:last-config';
const KIND_LABELS = { resume: 'Resume', job_description: 'Job description' } as const;

const DEFAULTS: InterviewConfig = {
  jobTitle: 'Software Engineer',
  jobFamily: 'software_engineering',
  level: 'junior',
  interviewType: 'behavioral',
  difficulty: 'medium',
  questionCount: 5,
  thinkingTimeSec: 10,
  followUpLimit: 1,
};

/** The last configuration used on this browser, so repeat practice is one click. */
function loadLastConfig(): InterviewConfig {
  try {
    const parsed = interviewConfigSchema.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    return parsed.success ? parsed.data : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function Field({ id, label, help, children }: { id: string; label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

function Select<T extends string>(props: {
  id: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
}) {
  return (
    <select
      id={props.id}
      className={fieldClass}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as T)}
    >
      {props.options.map((o) => (
        <option key={o} value={o}>
          {props.labels[o]}
        </option>
      ))}
    </select>
  );
}

function ResumeBanner() {
  const [open, setOpen] = useState<SessionSummary>();
  useEffect(() => {
    let active = true;
    getJson('/api/sessions?status=in_progress', z.array(sessionSummarySchema))
      .then((list) => active && setOpen(list[0]))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  if (!open) return null;
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/50 p-4 text-sm">
      <span>
        You have an unfinished {INTERVIEW_TYPE_LABELS[open.interviewType].toLowerCase()} interview ({open.jobTitle},{' '}
        {open.answered} of {open.totalQuestions} answered).
      </span>
      <Button asChild variant="outline" size="sm">
        <Link to={`/interview/${open.id}`}>Resume</Link>
      </Button>
    </div>
  );
}

export function NewInterview() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<InterviewConfig>(loadLastConfig);
  const [busy, setBusy] = useState<string>();
  const [shortfall, setShortfall] = useState<Extract<CreateSessionResponse, { status: 'needs_decision' }>>();
  const [error, setError] = useState<string>();
  // An interview can be based on a resume or job description (Documents); its questions are then written from it.
  const [params] = useSearchParams();
  const [documentId, setDocumentId] = useState(params.get('document') ?? '');
  const [documents, setDocuments] = useState<DocumentView[]>([]);
  useEffect(() => {
    let active = true;
    getJson('/api/documents', z.array(documentViewSchema))
      .then((list) => active && setDocuments(list.filter((d) => d.summary)))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const basedOn = documents.find((d) => d.id === documentId);

  // New users get their default thinking time from Settings.
  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    getJson('/api/settings', settingsSchema)
      .then((s) => setConfig((c) => ({ ...c, thinkingTimeSec: s.defaultThinkingTimeSec })))
      .catch(() => undefined);
  }, []);

  const set = <K extends keyof InterviewConfig>(key: K, value: InterviewConfig[K]) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setShortfall(undefined);
    setError(undefined);
  };
  const valid = interviewConfigSchema.safeParse(config);

  const submit = async (onShortfall: 'ask' | 'generate' | 'reduce') => {
    if (!valid.success) return;
    setBusy(
      basedOn
        ? `Writing ${valid.data.questionCount} questions from your ${KIND_LABELS[basedOn.kind].toLowerCase()} with the local model… this takes 1–3 minutes.`
        : onShortfall === 'generate'
          ? 'Writing new questions with the local model… this can take a minute or two.'
          : 'Preparing…',
    );
    setError(undefined);
    try {
      const res = await sendJson(
        'POST',
        '/api/sessions',
        { config: valid.data, onShortfall, documentId: basedOn?.id },
        createSessionResponseSchema,
      );
      if (res.status === 'needs_decision') {
        setShortfall(res);
        return;
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(valid.data));
      } catch {
        // storage unavailable (private window): not important
      }
      navigate(`/interview/${res.sessionId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New interview</h1>
        <p className="text-sm text-muted-foreground">
          Questions come from the local question bank, or are written from your resume or a job description (add them in{' '}
          <Link to="/documents" className="underline underline-offset-4">
            Documents
          </Link>
          ). The interviewer reads each question aloud, and you answer by voice or by typing.
        </p>
      </div>

      <ResumeBanner />

      <Card>
        <CardHeader>
          <CardTitle>Interview setup</CardTitle>
          <CardDescription>Your last setup is remembered on this computer.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit('ask');
            }}
          >
            <div className="sm:col-span-2">
              <Field
                id="based-on"
                label="Questions"
                help={
                  basedOn
                    ? basedOn.kind === 'resume'
                      ? 'Questions about the projects and roles in your resume, written by the local model.'
                      : "Questions on the job's required skills and responsibilities, written by the local model."
                    : undefined
                }
              >
                <select
                  id="based-on"
                  className={fieldClass}
                  value={basedOn ? documentId : ''}
                  onChange={(e) => {
                    setDocumentId(e.target.value);
                    setShortfall(undefined);
                  }}
                >
                  <option value="">From the question bank</option>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      From {KIND_LABELS[d.kind].toLowerCase()}: {d.title}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field id="job-title" label="Job title">
              <input
                id="job-title"
                className={fieldClass}
                value={config.jobTitle}
                maxLength={100}
                onChange={(e) => set('jobTitle', e.target.value)}
              />
            </Field>
            <Field id="job-family" label="Job family">
              <Select
                id="job-family"
                value={config.jobFamily}
                options={JOB_FAMILIES}
                labels={JOB_FAMILY_LABELS}
                onChange={(v) => set('jobFamily', v)}
              />
            </Field>
            <Field id="level" label="Experience level">
              <Select
                id="level"
                value={config.level}
                options={LEVELS}
                labels={LEVEL_LABELS}
                onChange={(v) => set('level', v)}
              />
            </Field>
            <Field id="type" label="Interview type">
              <Select
                id="type"
                value={config.interviewType}
                options={INTERVIEW_TYPES}
                labels={INTERVIEW_TYPE_LABELS}
                onChange={(v) => set('interviewType', v)}
              />
            </Field>
            <Field id="difficulty" label="Difficulty">
              <Select
                id="difficulty"
                value={config.difficulty}
                options={[...DIFFICULTIES, 'adaptive'] as const}
                labels={DIFFICULTY_LABELS}
                onChange={(v) => set('difficulty', v)}
              />
            </Field>
            <Field id="count" label="Number of questions" help="1–15">
              <input
                id="count"
                type="number"
                min={1}
                max={15}
                className={fieldClass}
                value={config.questionCount}
                onChange={(e) => set('questionCount', e.target.valueAsNumber)}
              />
            </Field>
            <Field id="follow-ups" label="Follow-ups per question" help="How often the interviewer may dig deeper.">
              <select
                id="follow-ups"
                className={fieldClass}
                value={config.followUpLimit}
                onChange={(e) => set('followUpLimit', Number(e.target.value))}
              >
                <option value={0}>None</option>
                <option value={1}>Up to 1</option>
                <option value={2}>Up to 2</option>
              </select>
            </Field>
            <Field
              id="thinking"
              label="Thinking time (seconds)"
              help="Pause before you answer. Used in voice mode (M7)."
            >
              <input
                id="thinking"
                type="number"
                min={0}
                max={60}
                className={fieldClass}
                value={config.thinkingTimeSec}
                onChange={(e) => set('thinkingTimeSec', e.target.valueAsNumber)}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field
                id="instructions"
                label="Custom instructions (optional)"
                help="For example: focus on teamwork and ownership."
              >
                <textarea
                  id="instructions"
                  rows={2}
                  maxLength={1000}
                  className={fieldClass}
                  value={config.customInstructions ?? ''}
                  onChange={(e) => set('customInstructions', e.target.value || undefined)}
                />
              </Field>
            </div>

            {shortfall && (
              <div
                role="alert"
                className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm sm:col-span-2"
              >
                <p>
                  The local bank has {shortfall.available} matching question{shortfall.available === 1 ? '' : 's'} for
                  these settings; you asked for {shortfall.requested}.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void submit('generate')} disabled={!!busy}>
                    Generate {shortfall.requested - shortfall.available} with the local model
                  </Button>
                  {shortfall.available > 0 && (
                    <Button type="button" variant="outline" onClick={() => void submit('reduce')} disabled={!!busy}>
                      Continue with {shortfall.available}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Generated questions are saved to the bank and marked as generated.
                </p>
              </div>
            )}

            <div className="flex items-center gap-3 sm:col-span-2">
              <Button type="submit" disabled={!valid.success || !!busy}>
                Prepare interview
              </Button>
              {!valid.success && <span className="text-sm text-destructive">Some values are out of range.</span>}
              {busy && (
                <span role="status" className="text-sm text-muted-foreground">
                  {busy}
                </span>
              )}
              {error && (
                <span role="alert" className="text-sm text-destructive">
                  {error}
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
