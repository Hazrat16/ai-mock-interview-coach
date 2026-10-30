import { Building2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { z } from 'zod';
import { addQuestionsResultSchema, type Company, companySchema } from '@shared/schemas/companies';
import { INTERVIEW_TYPES, type InterviewType } from '@shared/schemas/interview';
import { GENERATED_LABEL } from '@shared/schemas/provenance';
import { ProvenanceBadge } from '@/components/ProvenanceBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getJson, sendJson } from '@/lib/api';
import { INTERVIEW_TYPE_LABELS } from '@/lib/labels';
import { fieldClass } from '@/lib/styles';

const today = () => new Date().toISOString().slice(0, 10);

/** The role from your last interview setup on this browser (New interview), for predicted questions. */
function lastRole(): { jobTitle: string; level: string } {
  try {
    const c = JSON.parse(localStorage.getItem('interview-coach:last-config') ?? '{}') as Record<string, unknown>;
    return {
      jobTitle: typeof c.jobTitle === 'string' ? c.jobTitle : 'Software Engineer',
      level: typeof c.level === 'string' ? c.level : 'junior',
    };
  } catch {
    return { jobTitle: 'Software Engineer', level: 'junior' };
  }
}
const companiesSchema = z.array(companySchema);

/** Where it came from and when that was true: required for everything you add (R23). */
function SourceFields(props: {
  source: string;
  date: string;
  onSource: (v: string) => void;
  onDate: (v: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
      <input
        aria-label="Source"
        placeholder="Source: a link, “recruiter call”, “friend who interviewed there”…"
        className={fieldClass}
        value={props.source}
        maxLength={300}
        onChange={(e) => props.onSource(e.target.value)}
      />
      <input
        type="date"
        aria-label="Date of the information"
        className={fieldClass}
        value={props.date}
        max={today()}
        onChange={(e) => props.onDate(e.target.value)}
      />
    </div>
  );
}

function TypeSelect({
  value,
  onChange,
  label,
}: {
  value: InterviewType;
  onChange: (t: InterviewType) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      className={fieldClass}
      value={value}
      onChange={(e) => onChange(e.target.value as InterviewType)}
    >
      {INTERVIEW_TYPES.map((t) => (
        <option key={t} value={t}>
          {INTERVIEW_TYPE_LABELS[t]}
        </option>
      ))}
    </select>
  );
}

function AddNotes({ names, onDone }: { names: string[]; onDone: (message: string) => void }) {
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = company.trim() && title.trim() && text.trim().length >= 50 && source.trim().length >= 2 && date;

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await sendJson(
        'POST',
        '/api/companies/notes',
        { company: company.trim(), title: title.trim(), text, source: source.trim(), sourceDate: date },
        z.object({ summaryError: z.string().nullable() }),
      );
      setTitle('');
      setText('');
      onDone(
        r.summaryError
          ? `Saved your notes about ${company.trim()}, but the summary could not be written: ${r.summaryError}`
          : `Added your notes about ${company.trim()}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add notes about a company</CardTitle>
        <CardDescription>
          This app is offline and knows nothing current about any company. Paste what you found out yourself: an
          interview report you read, their values, what a recruiter told you. Give the source and the date.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            aria-label="Company"
            placeholder="Company"
            list="company-names"
            className={fieldClass}
            value={company}
            maxLength={120}
            onChange={(e) => setCompany(e.target.value)}
          />
          <datalist id="company-names">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <input
            aria-label="Notes title"
            placeholder="Title, e.g. Recruiter call"
            className={fieldClass}
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <textarea
          aria-label="Your notes"
          placeholder="Your notes about the company and its interviews"
          rows={6}
          maxLength={30_000}
          className={fieldClass}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <SourceFields source={source} date={date} onSource={setSource} onDate={setDate} />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void submit()} disabled={!ready || busy}>
            Add notes
          </Button>
          {busy && (
            <span role="status" className="text-muted-foreground">
              Writing a short summary with the local model… (about a minute)
            </span>
          )}
          {error && (
            <span role="alert" className="text-destructive">
              {error}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AddQuestions({ company, onDone }: { company: string; onDone: (message: string) => void }) {
  const [type, setType] = useState<InterviewType>('behavioral');
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [date, setDate] = useState(today());
  const [error, setError] = useState<string>();
  const questions = text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length >= 10);

  const submit = async () => {
    setError(undefined);
    try {
      const r = await sendJson(
        'POST',
        '/api/companies/questions',
        { company, interviewType: type, questions, source: source.trim(), sourceDate: date },
        addQuestionsResultSchema,
      );
      setText('');
      onDone(
        `Added ${r.added} question${r.added === 1 ? '' : 's'}${r.duplicates ? ` (${r.duplicates} already there)` : ''}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <h4 className="font-medium">Add questions you know they ask</h4>
      <TypeSelect value={type} onChange={setType} label={`Interview type for ${company} questions`} />
      <textarea
        aria-label={`Questions for ${company}, one per line`}
        placeholder="One question per line"
        rows={4}
        className={fieldClass}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <SourceFields source={source} date={date} onSource={setSource} onDate={setDate} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          onClick={() => void submit()}
          disabled={!questions.length || source.trim().length < 2 || !date}
        >
          Add {questions.length || ''} question{questions.length === 1 ? '' : 's'}
        </Button>
        {error && (
          <span role="alert" className="text-destructive">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

function Predict({ company, onDone }: { company: Company; onDone: (message: string) => void }) {
  const [type, setType] = useState<InterviewType>('behavioral');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const hasNotes = company.notes.some((n) => n.summary);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await sendJson(
        'POST',
        '/api/companies/predict',
        { company: company.name, interviewType: type, ...lastRole(), count: 3 },
        addQuestionsResultSchema,
      );
      onDone(`Predicted ${r.added} question${r.added === 1 ? '' : 's'} for ${company.name}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <h4 className="font-medium">Predict likely questions</h4>
      <p className="text-muted-foreground">
        The local model writes 3 questions from your notes only, never from what it may believe about {company.name}.
        They are always marked “{GENERATED_LABEL}”.
      </p>
      {hasNotes ? (
        <div className="flex flex-wrap items-center gap-3">
          <TypeSelect value={type} onChange={setType} label={`Interview type for ${company.name} predictions`} />
          <Button size="sm" variant="outline" onClick={() => void submit()} disabled={busy}>
            Predict 3 questions
          </Button>
          {busy && (
            <span role="status" className="text-muted-foreground">
              Writing questions from your notes… (1–2 minutes)
            </span>
          )}
        </div>
      ) : (
        <p className="text-amber-700 dark:text-amber-400">Add notes about {company.name} first.</p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function CompanyCard({ company, onChanged }: { company: Company; onChanged: (message: string) => void }) {
  const remove = async (id: string) => {
    const res = await fetch(`/api/companies/questions/${id}`, { method: 'DELETE' });
    onChanged(res.ok ? 'Question deleted.' : `Could not delete it (HTTP ${res.status}).`);
  };
  const removeNotes = async (id: string, title: string) => {
    if (!window.confirm(`Delete your notes "${title}"?`)) return;
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    onChanged(res.ok ? `Deleted "${title}".` : `Could not delete them (HTTP ${res.status}).`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="size-5" aria-hidden />
          {company.name}
        </CardTitle>
        <CardDescription>
          {company.notes.length} note{company.notes.length === 1 ? '' : 's'} · {company.questions.length} question
          {company.questions.length === 1 ? '' : 's'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {company.questions.length > 0 && (
          <Button asChild size="sm">
            <Link to={`/interview/new?company=${encodeURIComponent(company.name)}`}>Interview for {company.name}</Link>
          </Button>
        )}

        {company.notes.length > 0 && (
          <section className="space-y-3">
            <h3 className="font-medium">Your notes</h3>
            {company.notes.map((n) => (
              <div key={n.id} className="space-y-1.5 border-l-2 pl-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{n.title}</span>
                  <ProvenanceBadge provenance={{ kind: 'verified', source: n.source, date: n.sourceDate }} />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete notes ${n.title}`}
                    onClick={() => void removeNotes(n.id, n.title)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {n.summary ?? 'No summary yet: it is written when the local model is running.'}
                </p>
              </div>
            ))}
          </section>
        )}

        {company.questions.length > 0 && (
          <section className="space-y-2">
            <h3 className="font-medium">Questions</h3>
            <ul className="divide-y rounded-md border">
              {company.questions.map((q) => (
                <li key={q.id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="space-y-1">
                    <p>{q.text}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{INTERVIEW_TYPE_LABELS[q.interviewType]}</span>
                      <ProvenanceBadge provenance={q.provenance} />
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" aria-label="Delete question" onClick={() => void remove(q.id)}>
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <AddQuestions company={company.name} onDone={onChanged} />
        <Predict company={company} onDone={onChanged} />
      </CardContent>
    </Card>
  );
}

export function Companies() {
  const [list, setList] = useState<Company[]>();
  const [message, setMessage] = useState<string>();
  const load = useCallback(
    () =>
      getJson('/api/companies', companiesSchema)
        .then(setList)
        .catch((e: Error) => setMessage(e.message)),
    [],
  );
  useEffect(() => {
    let active = true;
    getJson('/api/companies', companiesSchema)
      .then((l) => active && setList(l))
      .catch((e: Error) => active && setMessage(e.message));
    return () => {
      active = false;
    };
  }, []);
  const changed = (m: string) => {
    setMessage(m);
    void load();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Companies</h1>
        <p className="text-sm text-muted-foreground">
          Prepare for a specific company with what you know about it. Start by adding your notes; then add questions you
          know they ask, or predict some from your notes. Everything shows where it came from:{' '}
          <em>Verified by you (source, date)</em>, or <em>{GENERATED_LABEL}</em>.
        </p>
      </div>
      <AddNotes names={list?.map((c) => c.name) ?? []} onDone={changed} />
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {list?.length === 0 && <p className="text-sm text-muted-foreground">No companies yet.</p>}
      {list?.map((c) => (
        <CompanyCard key={c.name} company={c} onChanged={changed} />
      ))}
    </div>
  );
}
