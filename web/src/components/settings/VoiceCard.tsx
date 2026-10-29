import { Play, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Settings, settingsSchema } from '@shared/schemas/settings';
import { type VoiceList, voiceListSchema } from '@shared/schemas/speech';
import { player } from '@/audio/player';
import { usePlayerState } from '@/audio/useSpeech';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getJson, sendJson } from '@/lib/api';
import { fieldClass } from '@/lib/styles';

type VoiceFields = Pick<Settings, 'speakInterviewer' | 'ttsVoice' | 'speechRate'>;

const SAMPLE =
  'Hello, and thanks for joining. Tell me about a time you had to learn something new quickly. What did you do first?';

export function VoiceCard() {
  const [voices, setVoices] = useState<VoiceList>();
  const [saved, setSaved] = useState<VoiceFields>();
  const [draft, setDraft] = useState<VoiceFields>();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string }>();
  const audio = usePlayerState();

  useEffect(() => {
    let active = true;
    Promise.all([getJson('/api/settings', settingsSchema), getJson('/api/speech/voices', voiceListSchema)])
      .then(([s, v]) => {
        if (!active) return;
        const fields = { speakInterviewer: s.speakInterviewer, ttsVoice: s.ttsVoice, speechRate: s.speechRate };
        setSaved(fields);
        setDraft(fields);
        setVoices(v);
      })
      .catch((e: Error) => active && setMessage({ kind: 'error', text: e.message }));
    return () => {
      active = false;
      player.stop();
    };
  }, []);

  if (!draft || !saved || !voices) return null;
  const set = <K extends keyof VoiceFields>(key: K, value: VoiceFields[K]) => {
    setDraft({ ...draft, [key]: value });
    setMessage(undefined);
  };
  const patch = Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => saved[key as keyof VoiceFields] !== value),
  ) as Partial<VoiceFields>;
  const selected = voices.voices.find((v) => v.id === draft.ttsVoice);

  const save = async () => {
    try {
      const s = await sendJson('PUT', '/api/settings', patch, settingsSchema);
      const fields = { speakInterviewer: s.speakInterviewer, ttsVoice: s.ttsVoice, speechRate: s.speechRate };
      setSaved(fields);
      setDraft(fields);
      setMessage({ kind: 'ok', text: 'Saved.' });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Interviewer voice</CardTitle>
        <CardDescription>
          Spoken by Piper on this computer. Every voice here has a public-domain or CC0 dataset.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={draft.speakInterviewer}
              onChange={(e) => set('speakInterviewer', e.target.checked)}
            />
            Read questions aloud
          </label>
          <div className="space-y-1.5">
            <label htmlFor="voice" className="text-sm font-medium">
              Voice
            </label>
            <select
              id="voice"
              className={fieldClass}
              value={draft.ttsVoice}
              onChange={(e) => set('ttsVoice', e.target.value as VoiceFields['ttsVoice'])}
            >
              {voices.voices.map((v) => (
                <option key={v.id} value={v.id} disabled={voices.piperRunning && !v.installed}>
                  {v.label}
                  {voices.piperRunning && !v.installed ? ' (not downloaded)' : ''}
                </option>
              ))}
            </select>
            {selected && <p className="text-xs text-muted-foreground">Dataset: {selected.datasetLicense}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rate" className="text-sm font-medium">
              Speed: {draft.speechRate.toFixed(2)}×
            </label>
            <input
              id="rate"
              type="range"
              min={0.8}
              max={1.3}
              step={0.05}
              className="w-full accent-primary"
              value={draft.speechRate}
              onChange={(e) => set('speechRate', e.target.valueAsNumber)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={Object.keys(patch).length === 0}>
              Save
            </Button>
            {audio.status === 'speaking' ? (
              <Button type="button" variant="outline" onClick={() => player.stop()}>
                <Square aria-hidden /> Stop
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={!voices.piperRunning}
                onClick={() => void player.speak(SAMPLE, { voice: draft.ttsVoice, speechRate: draft.speechRate })}
              >
                <Play aria-hidden /> Test voice
              </Button>
            )}
            {audio.status === 'error' && <span className="text-sm text-destructive">{audio.message}</span>}
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
