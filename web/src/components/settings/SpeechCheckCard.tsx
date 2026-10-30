import { Mic, RotateCcw, Save, Square, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { type SttResult, sttResultSchema, type SttSampleList, sttSampleListSchema } from '@shared/schemas/stt';
import { SPEECH_CHECK } from '@shared/speechCheck';
import { wordErrorRate } from '@shared/text/wer';
import {
  listMicrophones,
  loadMicOptions,
  type MicOptions,
  MicRecorder,
  type Recording,
  saveMicOptions,
} from '@/audio/recorder';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { deleteJson, getJson, postWav } from '@/lib/api';
import { fieldClass } from '@/lib/styles';

const MAX_SECONDS = 60;
type Phase =
  | { name: 'idle' }
  | { name: 'recording'; seconds: number; level: number }
  | { name: 'transcribing' }
  | { name: 'result'; result: SttResult; recording: Recording; mic: string; processing: boolean; saved: boolean }
  | { name: 'error'; message: string };

export function SpeechCheckCard() {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [samples, setSamples] = useState<SttSampleList>();
  const recorder = useRef<MicRecorder>(undefined);
  const [mic, setMic] = useState<MicOptions>(loadMicOptions);
  const [mics, setMics] = useState<{ deviceId: string; label: string }[]>([]);
  const chooseMic = (next: MicOptions) => {
    setMic(next);
    saveMicOptions(next);
  };
  const sentence = SPEECH_CHECK[index % SPEECH_CHECK.length]!.text;

  useEffect(() => {
    let active = true;
    getJson('/api/stt/samples', sttSampleListSchema)
      .then((s) => active && setSamples(s))
      .catch(() => undefined);
    listMicrophones()
      .then((m) => active && setMics(m))
      .catch(() => undefined);
    return () => {
      active = false;
      void recorder.current?.cancel(); // leaving the page always turns the microphone off
    };
  }, []);

  const stop = async () => {
    const r = recorder.current;
    if (!r) return;
    recorder.current = undefined;
    setPhase({ name: 'transcribing' });
    try {
      const recording = await r.stop();
      const result = await postWav('/api/stt', recording.wav, sttResultSchema);
      setPhase({
        name: 'result',
        result,
        recording,
        mic: r.deviceLabel,
        processing: mic.processing !== false,
        saved: false,
      });
    } catch (e) {
      setPhase({ name: 'error', message: (e as Error).message });
    }
  };

  const start = async () => {
    try {
      const r = await MicRecorder.start(
        (level, seconds) => setPhase((p) => (p.name === 'recording' ? { ...p, level, seconds } : p)),
        mic,
      );
      recorder.current = r;
      setMics(await listMicrophones()); // names are only available after permission was granted
      setPhase({ name: 'recording', seconds: 0, level: 0 });
    } catch (e) {
      setPhase({ name: 'error', message: (e as Error).message });
    }
  };

  // Stop automatically at the limit, so a forgotten recording does not keep the microphone on.
  const tooLong = phase.name === 'recording' && phase.seconds >= MAX_SECONDS;
  useEffect(() => {
    if (tooLong) void stop();
  }, [tooLong]); // eslint-disable-line react-hooks/exhaustive-deps -- run once when the limit is reached, not when stop changes

  const save = async () => {
    if (phase.name !== 'result') return;
    try {
      await postWav(
        `/api/stt/samples?${new URLSearchParams({
          reference: sentence,
          mic: phase.mic,
          processing: String(phase.processing),
        })}`,
        phase.recording.wav,
        z.object({ id: z.string() }),
      );
      setPhase({ ...phase, saved: true });
      setSamples(await getJson('/api/stt/samples', sttSampleListSchema));
    } catch (e) {
      setPhase({ name: 'error', message: (e as Error).message });
    }
  };

  const deleteAll = async () => {
    if (!window.confirm('Delete all saved recordings? This cannot be undone.')) return;
    await deleteJson('/api/stt/samples', z.object({ deleted: z.number() }));
    setSamples(await getJson('/api/stt/samples', sttSampleListSchema));
  };

  const wer = phase.name === 'result' ? wordErrorRate(sentence, phase.result.text) : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Speech recognition check</CardTitle>
        <CardDescription>
          Read the sentence aloud in your normal interview voice. It is transcribed on this computer; the recording is
          discarded unless you save it for the benchmark.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="mic" className="text-sm font-medium">
              Microphone
            </label>
            <select
              id="mic"
              className={fieldClass}
              value={mic.deviceId ?? ''}
              disabled={phase.name === 'recording'}
              onChange={(e) => chooseMic({ ...mic, deviceId: e.target.value || undefined })}
            >
              <option value="">System default</option>
              {mics.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={mic.processing ?? true}
              disabled={phase.name === 'recording'}
              onChange={(e) => chooseMic({ ...mic, processing: e.target.checked })}
            />
            Browser voice processing (echo cancellation, noise suppression, auto gain). Keep on with laptop speakers.
          </label>
        </div>

        <blockquote className="rounded-lg border bg-muted/40 p-4 text-base leading-relaxed">{sentence}</blockquote>

        <div className="flex flex-wrap items-center gap-3">
          {phase.name === 'recording' ? (
            <>
              <Button variant="destructive" onClick={() => void stop()}>
                <Square aria-hidden /> Stop
              </Button>
              <span role="status" className="flex items-center gap-2 text-sm font-medium text-destructive">
                <span className="size-2.5 animate-pulse rounded-full bg-destructive" aria-hidden />
                Recording {Math.floor(phase.seconds)} s
              </span>
              <span className="h-2 w-32 overflow-hidden rounded bg-muted" aria-label="Microphone level">
                <span
                  className="block h-full bg-emerald-500 transition-[width]"
                  style={{ width: `${Math.min(100, phase.level * 400)}%` }}
                />
              </span>
            </>
          ) : (
            <Button onClick={() => void start()} disabled={phase.name === 'transcribing'}>
              <Mic aria-hidden /> {phase.name === 'idle' ? 'Start recording' : 'Record again'}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={phase.name === 'recording' || phase.name === 'transcribing'}
            onClick={() => {
              setIndex((i) => i + 1);
              setPhase({ name: 'idle' });
            }}
          >
            <RotateCcw aria-hidden /> Next sentence
          </Button>
          {phase.name === 'transcribing' && (
            <span role="status" className="text-sm text-muted-foreground">
              Transcribing…
            </span>
          )}
        </div>

        {phase.name === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {phase.message}
          </p>
        )}

        {phase.name === 'result' && wer && (
          <div className="space-y-2 rounded-lg border p-4 text-sm" aria-live="polite">
            <p>
              <span className="font-medium">Heard:</span> {phase.result.text || <em>(nothing recognized)</em>}
            </p>
            <p className="text-muted-foreground">
              Word errors: <strong className="text-foreground">{Math.round(wer.wer * 100)}%</strong> ({wer.errors} of{' '}
              {wer.referenceWords} words) · {phase.recording.seconds.toFixed(1)} s of audio transcribed in{' '}
              {(phase.result.ms / 1000).toFixed(1)} s · model {phase.result.model} · {phase.mic || 'microphone'},
              processing {phase.processing ? 'on' : 'off'}
            </p>
            <Button variant="outline" size="sm" disabled={phase.saved} onClick={() => void save()}>
              <Save aria-hidden /> {phase.saved ? 'Saved' : 'Save for benchmark'}
            </Button>
          </div>
        )}

        {samples && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
            <span>
              {samples.samples.length} saved recording{samples.samples.length === 1 ? '' : 's'} for{' '}
              <code className="font-mono">make bench-stt</code> (in {samples.dir})
            </span>
            {samples.samples.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => void deleteAll()}>
                <Trash2 aria-hidden /> Delete saved recordings
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
