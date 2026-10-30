import { FileText, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { z } from 'zod';
import {
  type DocumentKind,
  documentResultSchema,
  type DocumentView,
  documentViewSchema,
} from '@shared/schemas/documents';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getJson, sendJson } from '@/lib/api';
import { fieldClass } from '@/lib/styles';

const KIND = {
  resume: { label: 'Resume', help: 'Upload a PDF or text file, or paste the text.' },
  job_description: { label: 'Job description', help: 'Paste the job posting.' },
} as const;
const SUMMARIZING = 'Reading it and writing a short summary with the local model… (about a minute)';

/** Sends a file as the raw request body; the server extracts its text on this computer. */
async function uploadFile(kind: DocumentKind, title: string, file: File) {
  const query = new URLSearchParams({ kind, title });
  const type = file.type === 'application/pdf' || file.type === 'text/plain' ? file.type : 'application/octet-stream';
  const res = await fetch(`/api/documents/upload?${query}`, {
    method: 'POST',
    headers: { 'content-type': type },
    body: file,
  });
  const body = (await res.json()) as unknown;
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Upload failed (HTTP ${res.status})`);
  return documentResultSchema.parse(body);
}

function AddDocument({ onAdded }: { onAdded: (message: string) => void }) {
  const [kind, setKind] = useState<DocumentKind>('resume');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const ready = title.trim() && (file || text.trim().length >= 50);
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = file
        ? await uploadFile(kind, title.trim(), file)
        : await sendJson(
            'POST',
            '/api/documents',
            { kind, title: title.trim(), company: company.trim() || undefined, text },
            documentResultSchema,
          );
      setTitle('');
      setCompany('');
      setText('');
      setFile(undefined);
      onAdded(
        r.summaryError
          ? `Saved "${r.document.title}", but the summary could not be written (${r.summaryError}). Use "Summarize again".`
          : `Added "${r.document.title}".`,
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
        <CardTitle>Add a document</CardTitle>
        <CardDescription>
          Read on this computer: the text never leaves it. The interviewer gets a short summary, not the whole document.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex gap-2" role="group" aria-label="Document type">
          {(Object.keys(KIND) as DocumentKind[]).map((k) => (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={kind === k ? 'default' : 'outline'}
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                setFile(undefined);
              }}
            >
              {KIND[k].label}
            </Button>
          ))}
        </div>
        <p className="text-muted-foreground">{KIND[kind].help}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            aria-label="Title"
            placeholder={kind === 'resume' ? 'Title, e.g. My resume 2026' : 'Title, e.g. Acme backend role'}
            className={fieldClass}
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
          {kind === 'job_description' && (
            <input
              aria-label="Company (optional)"
              placeholder="Company (optional)"
              className={fieldClass}
              value={company}
              maxLength={120}
              onChange={(e) => setCompany(e.target.value)}
            />
          )}
        </div>
        {kind === 'resume' && (
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border px-3 py-2 hover:bg-muted/50">
            <Upload className="size-4" aria-hidden />
            {file ? file.name : 'Choose a PDF or text file'}
            <input
              type="file"
              accept=".pdf,.txt,application/pdf,text/plain"
              className="sr-only"
              aria-label="Resume file"
              onChange={(e) => {
                setFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        )}
        {!file && (
          <textarea
            aria-label={kind === 'resume' ? 'Or paste the resume text' : 'Job description text'}
            placeholder={kind === 'resume' ? 'Or paste the text of your resume' : 'Paste the job description'}
            rows={8}
            maxLength={30_000}
            className={fieldClass}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void submit()} disabled={!ready || busy}>
            Add {KIND[kind].label.toLowerCase()}
          </Button>
          {file && (
            <Button variant="outline" onClick={() => setFile(undefined)} disabled={busy}>
              Remove file
            </Button>
          )}
          {busy && (
            <span role="status" className="text-muted-foreground">
              {SUMMARIZING}
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

function DocumentItem({ d, onChanged }: { d: DocumentView; onChanged: (message: string) => void }) {
  const [busy, setBusy] = useState<string>();
  const summarize = async () => {
    setBusy(SUMMARIZING);
    try {
      const r = await sendJson('POST', `/api/documents/${d.id}/summarize`, {}, documentResultSchema);
      onChanged(r.summaryError ? `The summary could not be written: ${r.summaryError}` : `Summarized "${d.title}".`);
    } catch (e) {
      onChanged((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${d.title}"? Interviews based on it are kept.`)) return;
    const res = await fetch(`/api/documents/${d.id}`, { method: 'DELETE' });
    onChanged(res.ok ? `Deleted "${d.title}".` : `Could not delete it (HTTP ${res.status}).`);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4" aria-hidden />
          {d.title}
        </CardTitle>
        <CardDescription>
          {KIND[d.kind].label}
          {d.company && ` · ${d.company}`} · added {new Date(d.createdAt).toLocaleDateString()} · {d.interviews}{' '}
          interview{d.interviews === 1 ? '' : 's'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {d.summary ? (
          <div className="space-y-1">
            <h4 className="font-medium">What the interviewer sees</h4>
            <p className="whitespace-pre-wrap text-muted-foreground">{d.summary}</p>
          </div>
        ) : (
          <p className="text-amber-700 dark:text-amber-400">No summary yet: interviews need one.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {d.summary && (
            <Button asChild size="sm">
              <Link to={`/interview/new?document=${d.id}`}>Interview based on this</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void summarize()} disabled={!!busy}>
            Summarize again
          </Button>
          <Button variant="outline" size="sm" onClick={() => void remove()} disabled={!!busy}>
            Delete
          </Button>
          {busy && (
            <span role="status" className="text-muted-foreground">
              {busy}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function Documents() {
  const [docs, setDocs] = useState<DocumentView[]>();
  const [message, setMessage] = useState<string>();
  const load = useCallback(
    () =>
      getJson('/api/documents', z.array(documentViewSchema))
        .then(setDocs)
        .catch((e: Error) => setMessage(e.message)),
    [],
  );
  useEffect(() => {
    let active = true;
    getJson('/api/documents', z.array(documentViewSchema))
      .then((d) => active && setDocs(d))
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
        <h1 className="text-2xl font-semibold">Documents</h1>
        <p className="text-sm text-muted-foreground">
          Add your resume or a job description, then start an interview based on it: the questions are written from it.
        </p>
      </div>
      <AddDocument onAdded={changed} />
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {docs?.length === 0 && <p className="text-sm text-muted-foreground">No documents yet.</p>}
      {docs?.map((d) => (
        <DocumentItem key={d.id} d={d} onChanged={changed} />
      ))}
    </div>
  );
}
