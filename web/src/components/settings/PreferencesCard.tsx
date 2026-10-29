import { useEffect, useState } from 'react';
import { type Settings, settingsSchema } from '@shared/schemas/settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getJson, sendJson } from '@/lib/api';

const fieldClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring';

function ModelSelect(props: {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  // Keep the saved value selectable even if that model is not downloaded (Ollama status shows it as missing).
  const options = props.options.includes(props.value) ? props.options : [props.value, ...props.options];
  return (
    <div className="space-y-1.5">
      <label htmlFor={props.id} className="text-sm font-medium">
        {props.label}
      </label>
      <select id={props.id} className={fieldClass} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {options.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberField(props: {
  id: string;
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={props.id} className="text-sm font-medium">
        {props.label}
      </label>
      <input
        id={props.id}
        type="number"
        className={fieldClass}
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => props.onChange(e.target.valueAsNumber)}
        aria-describedby={`${props.id}-help`}
      />
      <p id={`${props.id}-help`} className="text-xs text-muted-foreground">
        {props.help}
      </p>
    </div>
  );
}

export function PreferencesCard({ availableModels }: { availableModels: string[] }) {
  const [saved, setSaved] = useState<Settings>();
  const [draft, setDraft] = useState<Settings>();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string }>();

  useEffect(() => {
    let active = true;
    getJson('/api/settings', settingsSchema)
      .then((s) => active && (setSaved(s), setDraft(s)))
      .catch((e: Error) => active && setMessage({ kind: 'error', text: e.message }));
    return () => {
      active = false;
    };
  }, []);

  if (!draft || !saved) return null;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft({ ...draft, [key]: value });
    setMessage(undefined);
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const valid = settingsSchema.safeParse(draft).success;

  const save = async () => {
    try {
      const s = await sendJson('PUT', '/api/settings', draft, settingsSchema);
      setSaved(s);
      setDraft(s);
      setMessage({ kind: 'ok', text: 'Saved.' });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
        <CardDescription>Saved in the local database.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <ModelSelect
            id="interviewer-model"
            label="Interviewer model"
            value={draft.interviewerModel}
            options={availableModels}
            onChange={(v) => set('interviewerModel', v)}
          />
          <ModelSelect
            id="evaluator-model"
            label="Evaluation model"
            value={draft.evaluatorModel}
            options={availableModels}
            onChange={(v) => set('evaluatorModel', v)}
          />
          <NumberField
            id="silence"
            label="End-of-answer silence (seconds)"
            help="How long you stay silent before your answer counts as finished. 2–10."
            value={draft.endOfAnswerSilenceSec}
            min={2}
            max={10}
            onChange={(v) => set('endOfAnswerSilenceSec', v)}
          />
          <NumberField
            id="thinking"
            label="Default thinking time (seconds)"
            help="Pause before the microphone opens after each question. 0–60."
            value={draft.defaultThinkingTimeSec}
            min={0}
            max={60}
            onChange={(v) => set('defaultThinkingTimeSec', v)}
          />
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={draft.showTranscript}
              onChange={(e) => set('showTranscript', e.target.checked)}
            />
            Show the transcript during interviews
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={!changed || !valid}>
              Save
            </Button>
            {!valid && <span className="text-sm text-destructive">Some values are out of range.</span>}
            {message && (
              <span
                role="status"
                className={message.kind === 'ok' ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}
              >
                {message.text}
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
