import { Keyboard, Mic, RotateCcw, Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { type SessionDetail, sessionDetailSchema, turnResultSchema } from '@shared/schemas/interview';
import { type Settings, settingsSchema } from '@shared/schemas/settings';
import { player } from '@/audio/player';
import { loadMicOptions } from '@/audio/recorder';
import type { AnyVoiceInput, VoiceInputEvents } from '@/audio/vad';
import { usePlayerState } from '@/audio/useSpeech';
import { VoiceAnswer, type VoiceSubmit } from '@/components/interview/VoiceAnswer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { markReplyAudio, markResult, markSubmitted } from '@/interview/latency';
import { type InterviewState, type LogEntry, reduce } from '@/interview/turnMachine';
import { DEFAULT_VOICE_CONFIG } from '@/interview/voiceMachine';
import { getJson, sendJson } from '@/lib/api';
import { INTERVIEW_TYPE_LABELS, LEVEL_LABELS } from '@/lib/labels';
import { fieldClass } from '@/lib/styles';

function useElapsedSeconds(running: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => {
      clearInterval(id);
      setSeconds(0);
    };
  }, [running]);
  return seconds;
}

function Transcript({ log }: { log: LogEntry[] }) {
  if (log.length === 0) return <p className="text-sm text-muted-foreground">Nothing answered yet.</p>;
  return (
    <ol className="space-y-4">
      {log.map(({ turn, answer }) => (
        <li key={turn.id} className="space-y-1 text-sm">
          <p className="font-medium">
            {turn.kind === 'follow_up'
              ? `Follow-up to question ${turn.questionNumber}`
              : `Question ${turn.questionNumber}`}
            : {turn.text}
          </p>
          <p className={answer ? 'whitespace-pre-wrap text-muted-foreground' : 'italic text-muted-foreground'}>
            {answer ?? 'Skipped'}
          </p>
        </li>
      ))}
    </ol>
  );
}

/**
 * Identifies one asking of a question. The log grows with every reply, so a question asked again after
 * "I don't understand" (same turn) counts as new.
 */
const askingKey = (state: { current: { id: string }; log: unknown[] }) => `${state.current.id}:${state.log.length}`;

/** What the interviewer says aloud in this state, keyed so it is spoken once per asking. */
function utteranceOf(state: InterviewState): { key: string; text: string } | undefined {
  if (state.phase === 'answering' || state.phase === 'deciding') {
    return { key: askingKey(state), text: [state.speech, state.current.text].filter(Boolean).join(' ') };
  }
  return undefined; // the closing is spoken by the effect that then opens the report
}

/** Speaking status and controls. The text is always on screen, so audio problems never block the interview. */
function VoiceControls({ enabled }: { enabled: boolean }) {
  const audio = usePlayerState();
  if (!enabled) return null;
  if (audio.status === 'speaking') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Volume2 className="size-4 animate-pulse" aria-hidden /> Speaking…
        <Button variant="ghost" size="sm" onClick={() => player.stop()}>
          <Square aria-hidden /> Stop
        </Button>
      </div>
    );
  }
  if (audio.status === 'blocked') {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">The browser is waiting for a click before it plays sound.</span>
        <Button size="sm" onClick={() => void player.repeat()}>
          <Volume2 aria-hidden /> Play question
        </Button>
      </div>
    );
  }
  if (audio.status === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-destructive">Could not play the question: {audio.message}</span>
        <Button variant="outline" size="sm" onClick={() => void player.repeat()}>
          <RotateCcw aria-hidden /> Retry
        </Button>
      </div>
    );
  }
  return (
    <Button variant="ghost" size="sm" className="-ml-2" onClick={() => void player.repeat()}>
      <RotateCcw aria-hidden /> Repeat
    </Button>
  );
}

type AnswerMode = 'voice' | 'text';
const MODE_KEY = 'interview-coach:answer-mode';

function loadMode(): AnswerMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'text' ? 'text' : 'voice';
  } catch {
    return 'voice';
  }
}

function saveMode(mode: AnswerMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // storage unavailable: voice stays the default
  }
}

function Header({ detail, mode }: { detail: SessionDetail; mode: AnswerMode }) {
  const c = detail.config;
  return (
    <div>
      <h1 className="text-2xl font-semibold">
        {INTERVIEW_TYPE_LABELS[c.interviewType]} interview · {c.jobTitle}
      </h1>
      <p className="text-sm text-muted-foreground">
        {LEVEL_LABELS[c.level]} level ·{' '}
        {detail.turns.length === 0 ? c.questionCount : (detail.current?.totalQuestions ?? c.questionCount)} questions ·
        {mode === 'voice' ? 'spoken answers' : 'typed answers'}
      </p>
    </div>
  );
}

export function Interview() {
  const { id = '' } = useParams();
  const [state, dispatch] = useReducer(reduce, { phase: 'loading' });
  const [showTranscript, setShowTranscript] = useState(true);
  // undefined until settings load, so nothing is spoken before we know whether speech is on
  const [speakOn, setSpeakOn] = useState<boolean>();
  const [settings, setSettings] = useState<Settings>();
  const elapsed = useElapsedSeconds(state.phase === 'deciding');

  // Spoken answers: the microphone with speech detection is created after a click (permission prompt).
  const [mode, setMode] = useState<AnswerMode>(loadMode);
  const [voice, setVoice] = useState<{ input: AnyVoiceInput; note?: string }>();
  const [enabling, setEnabling] = useState(false);
  const [micError, setMicError] = useState<string>();
  /** A turn answered by typing although the interview is spoken ("type instead", or after a failure). */
  const [typedTurn, setTypedTurn] = useState<string>();
  const eventsRef = useRef<VoiceInputEvents | null>(null);
  const inputRef = useRef<AnyVoiceInput | undefined>(undefined);

  useEffect(() => {
    let active = true;
    getJson(`/api/sessions/${id}`, sessionDetailSchema)
      .then((detail) => active && dispatch({ type: 'loaded', detail }))
      .catch((e: Error) => active && dispatch({ type: 'failed', message: e.message }));
    getJson('/api/settings', settingsSchema)
      .then((s) => {
        if (!active) return;
        setShowTranscript(s.showTranscript);
        setSpeakOn(s.speakInterviewer);
        setSettings(s);
      })
      .catch(() => active && setSpeakOn(true));
    return () => {
      active = false;
    };
  }, [id]);

  const inTurn = state.phase === 'answering' || state.phase === 'deciding';
  // In a spoken turn, VoiceAnswer speaks the question itself (it has to know when the speech ends).
  const voiceTurn = inTurn && mode === 'voice' && !!voice && state.current.id !== typedTurn;

  const utterance = utteranceOf(state);
  const utteranceKey = utterance?.key;
  const utteranceText = voiceTurn ? undefined : utterance?.text;
  useEffect(() => {
    // markReplyAudio: the closing after a spoken last answer completes that turn's latency measurement.
    if (speakOn && utteranceText) void player.speak(utteranceText, { onFirstAudio: () => markReplyAudio() });
  }, [speakOn, utteranceKey, utteranceText]);
  // A finished interview (all questions, or ended early with answers) goes to its report, after the closing.
  const navigate = useNavigate();
  const closing = state.phase === 'completed' ? state.closing : null;
  const finished = state.phase === 'completed' && (closing !== null || state.detail.status === 'completed');
  useEffect(() => {
    if (!finished || speakOn === undefined) return;
    let active = true;
    const open = () => active && void navigate(`/interview/${id}/report`, { replace: true });
    if (speakOn && closing) void player.speak(closing, { onFirstAudio: () => markReplyAudio() }).then(open);
    else open();
    return () => {
      active = false;
    };
  }, [finished, closing, speakOn, id, navigate]);
  useEffect(
    () => () => {
      player.stop(); // leaving the page silences the interviewer
      void inputRef.current?.destroy(); // and releases the microphone
    },
    [],
  );

  /** Creates the speech detector and asks for the microphone, right after the user's click. */
  const enableVoice = useCallback(async () => {
    void player.unlock();
    setEnabling(true);
    setMicError(undefined);
    try {
      let note: string | undefined;
      if (!inputRef.current) {
        // Events go to whichever turn is on screen (VoiceAnswer registers itself in eventsRef).
        const forward: VoiceInputEvents = {
          onSpeechStart: (t) => eventsRef.current?.onSpeechStart(t),
          onSegment: (a, s0, s1) => eventsRef.current?.onSegment(a, s0, s1),
          onMisfire: () => eventsRef.current?.onMisfire(),
          onMicLost: () => eventsRef.current?.onMicLost(),
          onLevel: (v) => eventsRef.current?.onLevel?.(v),
        };
        // Loaded on first use: the detector and its runtime are ~470 KB of JavaScript.
        const { createVoiceInput } = await import('@/audio/vad');
        const created = await createVoiceInput(forward, loadMicOptions());
        inputRef.current = created.input;
        note = created.fallbackReason;
      }
      const input = inputRef.current;
      await input.open(); // the permission prompt appears now
      await input.close(); // closed again until the first question has been asked
      setVoice({ input, note });
      setMode('voice');
      saveMode('voice');
      return true;
    } catch (e) {
      setMicError((e as Error).message);
      return false;
    } finally {
      setEnabling(false);
    }
  }, []);

  const chooseTyping = useCallback(() => {
    setMode('text');
    saveMode('text');
  }, []);

  const start = useCallback(async () => {
    void player.unlock(); // inside the click, so the browser allows sound for the rest of the interview
    try {
      dispatch({
        type: 'started',
        detail: await sendJson('POST', `/api/sessions/${id}/start`, {}, sessionDetailSchema),
      });
    } catch (e) {
      dispatch({ type: 'failed', message: (e as Error).message });
    }
  }, [id]);

  const respond = useCallback(
    async (action: 'answer' | 'skip', turnId: string, transcript?: string, spoken?: VoiceSubmit) => {
      dispatch(action === 'answer' ? { type: 'submitted', text: spoken?.transcript } : { type: 'skipped' });
      if (action === 'answer' && !transcript?.trim()) return;
      player.stop();
      void player.unlock();
      try {
        const body =
          action === 'skip'
            ? {}
            : spoken
              ? {
                  transcript,
                  inputMethod: 'voice',
                  voice: spoken.delivery ? { sttModel: spoken.sttModel, delivery: spoken.delivery } : undefined,
                }
              : { transcript, inputMethod: 'typed_fallback' };
        markSubmitted();
        const result = await sendJson('POST', `/api/sessions/${id}/turns/${turnId}/${action}`, body, turnResultSchema);
        markResult();
        dispatch({ type: 'result', result });
      } catch (e) {
        // A spoken answer is not lost: it comes back as editable text with the error.
        if (spoken) setTypedTurn(turnId);
        dispatch({ type: 'failed', message: (e as Error).message });
      }
    },
    [id],
  );

  const end = useCallback(async () => {
    if (!window.confirm('End the interview now? Your answers so far are kept.')) return;
    player.stop();
    void inputRef.current?.close();
    try {
      dispatch({ type: 'ended', detail: await sendJson('POST', `/api/sessions/${id}/end`, {}, sessionDetailSchema) });
    } catch (e) {
      dispatch({ type: 'failed', message: (e as Error).message });
    }
  }, [id]);

  if (state.phase === 'loading') return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (state.phase === 'error') {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <p role="alert" className="text-destructive">
          {state.message}
        </p>
        <Link to="/interview/new" className="text-sm underline">
          Back to setup
        </Link>
      </div>
    );
  }

  if (state.phase === 'ready') {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Header detail={state.detail} mode={mode} />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm">
              The interviewer reads each question aloud and you answer by speaking. Your answer ends when you press Done
              (or Space), or after {settings?.endOfAnswerSilenceSec ?? 4} seconds of silence. Speech is transcribed on
              this computer and the audio is not kept.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={enabling}
                onClick={() =>
                  void enableVoice().then((ok) => {
                    if (ok) void start();
                  })
                }
              >
                <Mic aria-hidden /> Enable microphone and start
              </Button>
              <Button
                variant="outline"
                disabled={enabling}
                onClick={() => {
                  chooseTyping();
                  void start();
                }}
              >
                <Keyboard aria-hidden /> Start with typed answers
              </Button>
              {enabling && (
                <span role="status" className="text-sm text-muted-foreground">
                  Loading speech detection…
                </span>
              )}
            </div>
            {micError && (
              <p role="alert" className="text-sm text-destructive">
                {micError}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              You can leave at any time; the interview resumes where you stopped.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.phase === 'completed') {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Header detail={state.detail} mode={mode} />
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-lg">{state.closing ?? 'This interview has ended.'}</p>
            {state.closing && <VoiceControls enabled={!!speakOn} />}
            <p className="text-sm text-muted-foreground">
              Your report opens next: interview-ready answers and the key points to mention for each question.
            </p>
          </CardContent>
        </Card>
        <section aria-labelledby="answers-heading" className="space-y-3">
          <h2 id="answers-heading" className="font-semibold">
            Your answers
          </h2>
          <Transcript log={state.log} />
        </section>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link to={`/interview/${id}/report`}>View report</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/interview/new">Start another interview</Link>
          </Button>
        </div>
      </div>
    );
  }

  // answering or deciding
  const { current, speech, log } = state;
  const deciding = state.phase === 'deciding';
  const draft = state.phase === 'answering' ? state.draft : (state.pending ?? '');
  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  const answeringBy: AnswerMode = voiceTurn ? 'voice' : 'text';
  // Switching to voice turns the mic on from this click; switching to typing closes it (VoiceAnswer unmounts).
  const switchTo = (next: AnswerMode) => {
    if (next === 'text') {
      chooseTyping();
      return;
    }
    setTypedTurn(undefined);
    if (voice) {
      setMode('voice');
      saveMode('voice');
    } else void enableVoice();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Header detail={state.detail} mode={answeringBy} />
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Answer by" className="flex rounded-md border p-0.5">
            {(['voice', 'text'] as const).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={answeringBy === m ? 'secondary' : 'ghost'}
                aria-pressed={answeringBy === m}
                disabled={deciding || enabling}
                onClick={() => answeringBy !== m && switchTo(m)}
              >
                {m === 'voice' ? <Mic aria-hidden /> : <Keyboard aria-hidden />}
                {m === 'voice' ? 'Voice' : 'Typing'}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => void end()} disabled={deciding}>
            End interview
          </Button>
        </div>
      </div>
      {enabling && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading speech detection…
        </p>
      )}
      {micError && !voiceTurn && (
        <p role="alert" className="text-sm text-destructive">
          {micError}
        </p>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Question {current.questionNumber} of {current.totalQuestions}
            {current.kind === 'follow_up' && ' · follow-up'}
          </p>
          {speech && <p className="text-sm text-muted-foreground">{speech}</p>}
          <p className="text-lg leading-relaxed" aria-live="polite">
            {current.text}
          </p>
          {!voiceTurn && <VoiceControls enabled={!!speakOn} />}
        </CardContent>
      </Card>

      {voice?.note && voiceTurn && <p className="text-sm text-muted-foreground">{voice.note}</p>}

      {voiceTurn ? (
        <VoiceAnswer
          key={askingKey(state)}
          utterance={[speech, current.text].filter(Boolean).join(' ')}
          speakOn={speakOn ?? true}
          input={voice.input}
          eventsRef={eventsRef}
          config={{
            ...DEFAULT_VOICE_CONFIG,
            thinkingMs: state.detail.config.thinkingTimeSec * 1000,
            silenceMs: (settings?.endOfAnswerSilenceSec ?? 4) * 1000,
          }}
          deciding={deciding}
          decidingSeconds={elapsed}
          onSubmit={(a) => void respond('answer', current.id, a.transcript, a)}
          onFallback={(heard) => {
            setTypedTurn(current.id);
            dispatch({ type: 'draft', text: heard });
          }}
          onSkip={() => void respond('skip', current.id)}
        />
      ) : mode === 'voice' && !voice && current.id !== typedTurn ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm">Turn the microphone on to continue answering by voice.</p>
            <div className="flex flex-wrap gap-3">
              <Button disabled={enabling} onClick={() => void enableVoice()}>
                <Mic aria-hidden /> Continue with voice
              </Button>
              <Button variant="outline" onClick={chooseTyping}>
                <Keyboard aria-hidden /> Type answers instead
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void respond('answer', current.id, draft);
          }}
        >
          <label htmlFor="answer" className="text-sm font-medium">
            Your answer
          </label>
          <textarea
            id="answer"
            rows={8}
            autoFocus
            className={fieldClass}
            value={draft}
            disabled={deciding}
            onChange={(e) => dispatch({ type: 'draft', text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void respond('answer', current.id, draft);
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={deciding}>
              Submit answer
            </Button>
            <Button type="button" variant="ghost" disabled={deciding} onClick={() => void respond('skip', current.id)}>
              Skip question
            </Button>
            <span className="text-xs text-muted-foreground">{words} words · Ctrl+Enter to submit</span>
          </div>
          <div role="status" aria-live="polite" className="text-sm">
            {deciding && <p className="text-muted-foreground">The interviewer is thinking… {elapsed} s</p>}
            {state.phase === 'answering' && state.error && <p className="text-destructive">{state.error}</p>}
          </div>
          {mode === 'voice' && current.id === typedTurn && (
            <p className="text-xs text-muted-foreground">
              Typing this answer; the next question is answered by voice again.
            </p>
          )}
        </form>
      )}

      <section aria-labelledby="transcript-heading" className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between">
          <h2 id="transcript-heading" className="font-semibold">
            Transcript
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setShowTranscript((v) => !v)} aria-expanded={showTranscript}>
            {showTranscript ? 'Hide' : 'Show'}
          </Button>
        </div>
        {showTranscript && <Transcript log={log} />}
      </section>
    </div>
  );
}
