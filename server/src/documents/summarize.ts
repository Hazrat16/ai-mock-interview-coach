// A short summary of a job description or resume (≤ ~300 tokens), written once when the document is added.
// Interview prompts get this summary, never the full document (R21, R22).
import { z } from 'zod';
import type { DocumentKind } from '@shared/schemas/documents';
import { type OllamaClient, NUM_CTX } from '../llm/ollamaClient';
import { structuredChat } from '../llm/structured';

/** Bump when the prompts or schemas change. */
export const SUMMARY_PROMPT_VERSION = 1;
const MAX_PROMPT_CHARS = 12_000; // ~3000 tokens: the start of a long document is enough

const list = (max: number) => z.array(z.string()).max(max);

const schemas = {
  job_description: z.object({
    role: z.string(),
    company: z.string(),
    required_skills: list(10),
    responsibilities: list(6),
    nice_to_have: list(5),
  }),
  resume: z.object({
    headline: z.string(),
    skills: list(12),
    projects: z
      .array(z.object({ name: z.string(), what: z.string(), technologies: list(6), outcome: z.string() }))
      .max(5),
    experience: z.array(z.object({ role: z.string(), place: z.string(), highlight: z.string() })).max(4),
  }),
};

const INSTRUCTIONS: Record<DocumentKind, string> = {
  job_description:
    'Summarize this job description for an interviewer. Use only facts stated in it. required_skills: the concrete skills, ' +
    'technologies and qualifications it asks for, most important first. company: empty if not named.',
  resume:
    "Summarize this resume for an interviewer. Use only facts stated in it. projects: the candidate's most substantial " +
    "projects (name, what was built and the candidate's part, technologies, measurable outcome or empty). experience: " +
    'recent roles, each with one concrete highlight.',
};

const line = (label: string, items: string[]) => (items.length ? `${label}: ${items.join('; ')}.` : '');

/** The summary as plain text for prompts and for the Documents page. */
function render(kind: DocumentKind, s: Record<string, unknown>): string {
  if (kind === 'job_description') {
    const j = s as z.infer<(typeof schemas)['job_description']>;
    return [
      `Role: ${j.role}${j.company ? ` at ${j.company}` : ''}.`,
      line('Required skills', j.required_skills),
      line('Responsibilities', j.responsibilities),
      line('Nice to have', j.nice_to_have),
    ]
      .filter(Boolean)
      .join('\n');
  }
  const r = s as z.infer<(typeof schemas)['resume']>;
  return [
    `Candidate: ${r.headline}.`,
    line('Skills', r.skills),
    ...r.projects.map(
      (p) =>
        `Project "${p.name}": ${p.what}${p.technologies.length ? ` (${p.technologies.join(', ')})` : ''}${p.outcome ? `; result: ${p.outcome}` : ''}.`,
    ),
    ...r.experience.map((e) => `Experience: ${e.role}, ${e.place}: ${e.highlight}.`),
  ]
    .filter(Boolean)
    .join('\n');
}

export async function summarizeDocument(
  llm: OllamaClient,
  opts: { model: string; numThread?: number; timeoutMs?: number },
  kind: DocumentKind,
  text: string,
): Promise<string> {
  const reply = await structuredChat(llm, {
    model: opts.model,
    schema: schemas[kind] as z.ZodType<Record<string, unknown>>,
    messages: [
      { role: 'system', content: `${INSTRUCTIONS[kind]} Keep every item short. Reply with JSON only.` },
      { role: 'user', content: text.slice(0, MAX_PROMPT_CHARS) },
    ],
    options: { temperature: 0.1, seed: 42, num_ctx: NUM_CTX, num_predict: 600, num_thread: opts.numThread },
    keepAlive: '10m',
    timeoutMs: opts.timeoutMs ?? 240_000,
  });
  return render(kind, reply.data);
}
