import { CornerDownLeft, Keyboard, Mic, MicOff, Pause, Play, RotateCcw, SkipForward, Volume2 } from 'lucide-react';
import { type RefObject, useEffect, useReducer, useRef, useState } from 'react';
import type { Delivery } from '@shared/delivery';
import { sttResultSchema } from '@shared/schemas/stt';
import { player } from '@/audio/player';
import { usePlayerState } from '@/audio/useSpeech';
import type { AnyVoiceInput, VoiceInputEvents } from '@/audio/vad';
import { encodeWav } from '@/audio/wav';
import { Button } from '@/components/ui/button';
import { markAnswerEnd, markReplyAudio } from '@/interview/latency';
import {
  initialVoiceState,
  MAX_LENGTH_WARNING_MS,
  micOpen,
  REPROMPT,
  segmentsOf,
  silenceCountdown,
  type VoiceConfig,
  voiceReduce,
} from '@/interview/voiceMachine';
import { postWav } from '@/lib/api';

/** After the interviewer stops, wait this long before opening the mic, so the speakers' echo has faded (D3). */
const ECHO_GUARD_MS = 400;
/** How long to wait for the last piece of speech after Done is pressed mid-word. */
const TAIL_TIMEOUT_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type VoiceSubmit = { transcript: string; sttModel: string; delivery?: Delivery };

type Props = {
  /** What the interviewer says for this turn (acknowledgment, transition, question). */
  utterance: string;
  speakOn: boolean;
  input: AnyVoiceInput;
  /** The page's microphone events are forwarded to whichever turn is on screen. */
  eventsRef: RefObject<VoiceInputEvents | null>;
  config: VoiceConfig;
  /** The answer was submitted and the interviewer is deciding (the page tracks this). */
  deciding: boolean;
  decidingSeconds: number;
  onSubmit: (answer: VoiceSubmit) => void;
  onFallback: (heard: string) => void;
  onSkip: () => void;
};

function formatSeconds(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function VoiceAnswer(props: Props) {
  const { utterance, speakOn, input, eventsRef, config, onSubmit, onFallback } = props;
  const [s, send] = useReducer(voiceReduce, config, initialVoiceState);
  const [now, setNow] = useState(() => performance.now());
  const [micLive, setMicLive] = useState(false);
  const [micError, setMicError] = useState<string>();
  const [shownLevel, setShownLevel] = useState(0);
  const audio = usePlayerState();
  const level = useRef(0);
  const audioById = useRef(new Map<number, Float32Array>());
  const inFlight = useRef(new Set<number>());
  const nextId = useRef(1);
  const sttModel = useRef('');

  // Microphone events go to this turn while it is on screen.
  useEffect(() => {
    eventsRef.current = {
      onSpeechStart: (t) => send({ type: 'speech_start', now: t }),
      onSegment: (samples, startMs, endMs) => {
        const id = nextId.current++;
        audioById.current.set(id, samples); // kept in memory only until it is transcribed
        send({ type: 'segment', id, startMs, endMs });
      },
      onMisfire: () => send({ type: 'misfire' }),
      onMicLost: () => {
        setMicError('The microphone stopped. Check that it is connected, then click Reconnect.');
        send({ type: 'mic_lost' });
      },
      onLevel: (v) => (level.current = v),
    };
    return () => {
      eventsRef.current = null;
    };
  }, [eventsRef]);

  // Speak the question (or the reprompt) once per utterance; the mic stays closed meanwhile.
  const speechId = s.step === 'speaking' ? s.speeches : null;
  const say = s.step === 'speaking' ? s.say : null;
  useEffect(() => {
    if (speechId === null) return;
    let cancelled = false;
    void (async () => {
      const text = say === 'reprompt' ? REPROMPT : utterance;
      if (speakOn) {
        const result = await player.speak(text, { onFirstAudio: () => markReplyAudio() });
        // 'stopped': pause or repeat took over. 'blocked': the browser waits for a click (Play button below).
        const proceed = result === 'done' || (result === 'failed' && player.getState().status === 'error');
        if (!proceed || cancelled) return;
      }
      await sleep(ECHO_GUARD_MS);
      if (!cancelled) send({ type: 'spoken', now: performance.now() });
    })();
    return () => {
      cancelled = true;
    };
  }, [speechId, say, utterance, speakOn]);

  // Open the mic only for thinking time and listening.
  const wantMic = micOpen(s);
  useEffect(() => {
    let cancelled = false;
    if (wantMic) {
      input
        .open()
        .then(() => {
          if (cancelled) return;
          setMicLive(true);
          setMicError(undefined);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setMicError(e.message);
          send({ type: 'mic_lost' });
        });
    } else {
      void input.close().finally(() => !cancelled && setMicLive(false));
    }
    return () => {
      cancelled = true;
    };
  }, [wantMic, input]);
  useEffect(() => () => void input.close(), [input]); // leaving this turn always closes the mic

  // Clock for thinking time, end-of-answer silence and the maximum length.
  const ticking = s.step === 'thinking' || s.step === 'listening';
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => {
      const t = performance.now();
      setNow(t);
      setShownLevel(level.current);
      send({ type: 'tick', now: t });
    }, 200);
    return () => clearInterval(id);
  }, [ticking]);

  const awaitingTail = s.step === 'transcribing' && !!s.awaitingTail;
  useEffect(() => {
    if (!awaitingTail) return;
    const id = setTimeout(() => send({ type: 'tail_timeout' }), TAIL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [awaitingTail]);

  // Transcribe each segment as soon as it ends (one automatic retry), while you keep talking.
  const segments = segmentsOf(s);
  useEffect(() => {
    for (const g of segments) {
      if (g.status !== 'pending' || inFlight.current.has(g.id)) continue;
      inFlight.current.add(g.id);
      void (async () => {
        const samples = audioById.current.get(g.id);
        try {
          if (!samples) throw new Error('audio missing');
          const wav = new Blob([encodeWav(samples)], { type: 'audio/wav' });
          for (let attempt = 0; ; attempt++) {
            try {
              const r = await postWav('/api/stt', wav, sttResultSchema);
              sttModel.current = r.model;
              audioById.current.delete(g.id);
              send({ type: 'stt_done', id: g.id, text: r.text });
              return;
            } catch (err) {
              if (attempt >= 1) throw err;
              await sleep(1500);
            }
          }
        } catch {
          send({ type: 'stt_failed', id: g.id });
        } finally {
          inFlight.current.delete(g.id);
        }
      })();
    }
  }, [segments]);

  const submitted = useRef(false);
  useEffect(() => {
    if (s.step === 'ready' && !submitted.current) {
      submitted.current = true;
      markAnswerEnd(s.endedAt);
      onSubmit({ transcript: s.transcript, sttModel: sttModel.current, delivery: s.delivery });
    }
    if (s.step === 'fallback' && !submitted.current) {
      submitted.current = true;
      onFallback(s.heard);
    }
  }, [s, onSubmit, onFallback]);

  const pauseOrResume = () => {
    if (s.step === 'paused') {
      void player.unlock();
      send({ type: 'resume', now: performance.now() });
    } else {
      player.stop();
      send({ type: 'pause' });
    }
  };
  const repeat = () => {
    void player.unlock(); // inside the click: lets audio play if the browser was blocking it
    send({ type: 'repeat' });
  };
  const done = () => send({ type: 'done', now: performance.now() });
  const busy = props.deciding || s.step === 'ready' || s.step === 'fallback';

  // Keyboard: Space = done, P = pause/resume, R = repeat (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)
        return;
      if (e.key === ' ' && t.tagName !== 'BUTTON') {
        e.preventDefault();
        send({ type: 'done', now: performance.now() });
      } else if (e.key === 'p' || e.key === 'P') {
        if (s.step === 'paused') send({ type: 'resume', now: performance.now() });
        else {
          player.stop();
          send({ type: 'pause' });
        }
      } else if (e.key === 'r' || e.key === 'R') {
        void player.unlock();
        send({ type: 'repeat' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.step]);

  const heard = segments
    .filter((g) => g.status === 'done' && g.text)
    .map((g) => g.text)
    .join(' ');
  const pending = segments.some((g) => g.status === 'pending');
  const countdown = silenceCountdown(s, now);
  const answerElapsed = s.step === 'listening' ? now - s.startedAt : 0;
  const nearMax = s.step === 'listening' && config.maxAnswerMs - answerElapsed <= MAX_LENGTH_WARNING_MS;

  let status: React.ReactNode;
  if (props.deciding || s.step === 'ready') {
    status = <span className="text-muted-foreground">The interviewer is thinking… {props.decidingSeconds} s</span>;
  } else if (s.step === 'speaking') {
    status =
      audio.status === 'blocked' ? (
        <span>The browser is waiting for a click before it plays sound.</span>
      ) : (
        <span className="flex items-center gap-2">
          <Volume2 className="size-4 animate-pulse" aria-hidden /> Interviewer speaking
        </span>
      );
  } else if (s.step === 'thinking') {
    status = (
      <span>
        Thinking time · {Math.max(0, Math.ceil((s.until - now) / 1000))} s. Start speaking whenever you are ready.
      </span>
    );
  } else if (s.step === 'listening') {
    status = (
      <span className="flex flex-wrap items-center gap-3">
        <span className="font-medium">Listening</span>
        <span className="h-2 w-28 overflow-hidden rounded bg-muted" aria-hidden>
          <span
            className="block h-full bg-emerald-500 transition-[width]"
            style={{ width: `${Math.min(100, shownLevel * 400)}%` }}
          />
        </span>
        <span className="tabular-nums text-muted-foreground">{formatSeconds(answerElapsed)}</span>
        {countdown !== undefined && (
          <span className="font-medium text-amber-700 dark:text-amber-400">Finishing your answer in {countdown}…</span>
        )}
        {nearMax && <span className="text-destructive">15 seconds left for this answer</span>}
      </span>
    );
  } else if (s.step === 'transcribing') {
    status = <span>Transcribing…</span>;
  } else if (s.step === 'paused') {
    status = <span>{s.reason === 'mic_lost' ? 'Microphone disconnected' : 'Paused'}</span>;
  } else if (s.step === 'stt_error') {
    status = <span className="text-destructive">Part of your answer could not be transcribed.</span>;
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div role="status" aria-live="polite" className="text-sm">
          {status}
        </div>
        {micLive && (
          <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-destructive">
            <span className="size-2.5 animate-pulse rounded-full bg-destructive" aria-hidden />
            Recording
          </span>
        )}
      </div>

      {(heard || pending) && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Heard so far:</span> {heard}
          {pending && ' …'}
        </p>
      )}
      {s.step === 'speaking' && s.say === 'reprompt' && <p className="text-sm">{REPROMPT}</p>}
      {micError && (
        <p role="alert" className="text-sm text-destructive">
          {micError}
        </p>
      )}
      {audio.status === 'error' && s.step !== 'speaking' && (
        <p className="text-sm text-muted-foreground">
          Speech is unavailable ({audio.message}); read the question above.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(s.step === 'thinking' || s.step === 'listening') && (
          <Button onClick={done}>
            <CornerDownLeft aria-hidden /> Done <kbd className="ml-1 text-xs opacity-70">Space</kbd>
          </Button>
        )}
        {s.step === 'speaking' && audio.status === 'blocked' && (
          <Button onClick={repeat}>
            <Volume2 aria-hidden /> Play question
          </Button>
        )}
        {s.step === 'stt_error' && (
          <>
            <Button onClick={() => send({ type: 'retry_stt' })}>
              <RotateCcw aria-hidden /> Retry
            </Button>
            <Button variant="outline" onClick={() => send({ type: 'drop_failed' })}>
              Continue without it
            </Button>
            <Button variant="ghost" onClick={() => onFallback(heard)}>
              <Keyboard aria-hidden /> Type instead
            </Button>
          </>
        )}
        {!busy && s.step !== 'transcribing' && s.step !== 'stt_error' && (
          <>
            <Button variant="outline" onClick={pauseOrResume}>
              {s.step === 'paused' ? (
                s.reason === 'mic_lost' ? (
                  <>
                    <Mic aria-hidden /> Reconnect
                  </>
                ) : (
                  <>
                    <Play aria-hidden /> Resume
                  </>
                )
              ) : (
                <>
                  <Pause aria-hidden /> Pause <kbd className="ml-1 text-xs opacity-70">P</kbd>
                </>
              )}
            </Button>
            <Button variant="ghost" onClick={repeat}>
              <RotateCcw aria-hidden /> Repeat question <kbd className="ml-1 text-xs opacity-70">R</kbd>
            </Button>
          </>
        )}
        {!busy && (
          <Button
            variant="ghost"
            onClick={() => {
              player.stop();
              props.onSkip();
            }}
          >
            <SkipForward aria-hidden /> Skip question
          </Button>
        )}
        {s.step === 'paused' && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <MicOff className="size-3.5" aria-hidden /> Microphone off
          </span>
        )}
      </div>
    </div>
  );
}
