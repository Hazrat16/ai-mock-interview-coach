# 04. Architecture and Data Flow

## 1. Component diagram

```
 ┌──────────────────────────── Browser (Chrome/Firefox, http://127.0.0.1:4317) ───────────────────────────┐
 │  React SPA                                                                                             │
 │  ┌──────────────┐  frames  ┌──────────────────┐  segment PCM  ┌────────────────────────────────────┐  │
 │  │ Mic capture  │ ───────► │ Silero VAD (wasm)│ ────────────► │ Client turn state machine          │  │
 │  │ getUserMedia │          │ self-hosted onnx │               │ (asking/listening/transcribing/...)│  │
 │  └──────────────┘          └──────────────────┘               └──────┬─────────────────▲──────────┘  │
 │        ▲ mic released while interviewer speaks                       │ HTTP (JSON/WAV) │ WAV audio    │
 │  ┌─────┴────────┐  ◄──────────────── plays sentence WAVs ────────────┤                 │              │
 │  │ Audio player │                                                    │                 │              │
 └──┴──────────────┴────────────────────────────────────────────────────┼─────────────────┼──────────────┘
                                                                        ▼                 │
 ┌──────────────────────────── Fastify server (Node 24, 127.0.0.1:4317) ──────────────────┴──────────────┐
 │  routes/ ─► interview engine ─► question planner ─► prompts ─► ollamaClient ──────────┐               │
 │         ─► speech: sttClient ─────────────────────────────────────────────┐            │               │
 │         ─► speech: ttsClient (sentence chunker, phrase cache) ─────────┐   │            │               │
 │  evaluation job queue (runs after interview) ─► rubrics ─► scoring ───┼───┼────────────┤               │
 │  db (better-sqlite3) ◄──────────────── all writes                     │   │            │               │
 │  process supervisor: spawns/health-checks/stops children              │   │            │               │
 └───────────────────────────────────────────────────────────────────────┼───┼────────────┼───────────────┘
                                                                         ▼   ▼            ▼
                         ┌─────────────────────┐ ┌──────────────────────┐ ┌─────────────────────────────┐
                         │ Piper HTTP server   │ │ whisper-server       │ │ ollama serve                │
                         │ 127.0.0.1:5002      │ │ 127.0.0.1:8178       │ │ 127.0.0.1:11434             │
                         │ POST /synthesize    │ │ POST /inference      │ │ /api/chat, /api/ps          │
                         │ (child process)     │ │ (child process)      │ │ OLLAMA_NO_CLOUD=1           │
                         └─────────────────────┘ └──────────────────────┘ └─────────────────────────────┘
   SQLite: ~/.local/share/ai-interview-coach/coach.db (ext4)
   Models: /media/hazrat/Hazrat8/ai-models/{ollama,whisper,piper} (NTFS, read-mostly)
```

### Responsibilities

| Component | Responsibility | Does NOT do |
|-----------|----------------|-------------|
| Browser SPA | UI, mic permission, VAD, WAV encoding, playback, client turn state machine, keyboard controls | Talk to Ollama, Whisper, or Piper directly. Everything goes through the server so there is one network boundary |
| Fastify server | API, persistence, interview engine, prompts, JSON validation, evaluation queue, child-process supervision, serving the SPA build | Hold raw audio beyond a single request |
| Ollama | LLM inference | Store any app data |
| whisper-server | WAV → text with timestamps and confidence | Anything else |
| Piper server | text → WAV | Anything else |
| SQLite | All persistent state, including the job queue | – |

**Why the client drives the turn loop:** each step is a plain request and response (`POST /stt`, `POST /turn`, `POST /tts`), which is easy to debug in DevTools, test with Playwright, and recover from. The server persists every step, so a page reload can resume the session from the database.

## 2. Start and stop

`npm start` (or `scripts/coach start`):
1. Load `.env` and validate it with Zod. Fail fast with readable messages.
2. Open SQLite, take a pre-migration backup if migrations are pending, then run them.
3. Check `GET 127.0.0.1:11434/api/version`. If it does not answer, spawn `ollama serve` with `OLLAMA_MODELS`, `OLLAMA_HOST=127.0.0.1:11434`, and `OLLAMA_NO_CLOUD=1`, and remember that **we** started it.
4. Spawn `whisper-server` and the Piper server, then poll their health endpoints (timeout 30 s each). A failure marks that component **degraded**; the app still starts and Settings shows how to fix it.
5. Listen on `127.0.0.1:4317` and print the URL. Optionally open it in the browser.
6. Resume any `pending` evaluation jobs.

`Ctrl+C`, `scripts/coach stop`, or SIGTERM: stop accepting requests, let a running evaluation finish its current request (max 10 s) or mark it `pending` for next time, send SIGTERM to children (SIGKILL after 5 s), stop `ollama serve` **only if we started it**, then close the database.

**No unnecessary background processes:** nothing runs when the app is closed. Ollama's install-time systemd service is disabled in M0. Models unload after `keep_alive` (10 minutes during sessions, `0` = immediately at session end).

## 3. Audio interview flow (one turn)

```
Interviewer speaks          You answer                         Server decides               Interviewer speaks
────────────────────    ───────────────────────────────────    ───────────────────────     ────────────────────
TTS sentences play ──►  [thinking time countdown]          ──► last segment STT        ──► POST /turn         ──► ack phrase plays
mic CLOSED              mic OPEN, VAD running                   join segment texts          LLM JSON decision       (cached WAV)
                        each speech segment ends ─► POST /stt   save answer                 validate (Zod)          follow-up or next
                        (transcribed while you keep talking)    delivery metrics            fallback on failure     question TTS
                        Done / Space / silence countdown
```

Step by step:

1. **Speak question.** The server returns the question text. The client splits it into sentences, requests `/tts` for sentence 1 and plays it while sentence 2 is synthesized. The mic is closed while the interviewer speaks. Fixed phrases ("Take your time", "Thanks", "Let's move on") are pre-synthesized at session start.
2. **Thinking time.** A countdown runs (configurable, may be 0). Silence does not end the answer. Speaking starts the answer early.
3. **Listening.** Silero VAD emits `speechStart`/`speechEnd` with 16 kHz PCM per **segment**. Each segment is encoded to WAV and posted to `/api/stt` immediately, so transcription overlaps your speaking.
4. **Final answer vs. partial utterance.** A pause ends a *segment*, not the *answer*. The answer is final when:
   - you click **Done** or press **Space**, or
   - silence after the last segment exceeds `endOfAnswerSilence` (default 4 s, range 2–10 s). A visible 3-2-1 ring shows "Finishing your answer…" and any new speech cancels it, or
   - the maximum answer length is reached (default 4 min), with a 15 s warning.
   VAD settings: `positiveSpeechThreshold`, `negativeSpeechThreshold`, `redemptionMs ≈ 800` (short pauses inside a sentence stay in the same segment), and `minSpeechMs ≈ 250` (drops coughs and clicks).
5. **Transcribing.** Wait for any outstanding segment requests, then join the texts in order. Segments with Whisper `no_speech_prob > 0.6` or empty text are discarded. If the joined answer is under 3 words, the app says "Sorry, I didn't catch that, could you repeat?" (max 2 times), then offers the typed fallback.
6. **Deciding.** `POST /api/sessions/:id/turns/:turnId/answer` stores the answer and calls the LLM with a **compact context** (below). Strict JSON schema via Ollama's `format`, timeout 25 s, one repair retry. On failure it uses `{action: "next", ack: "Thank you."}`.
7. **Respond.** Play the acknowledgment, then the follow-up or next question. After the last question, play the closing line, set the session to `completed`, and enqueue one evaluation job per answer.

## 4. Conversation context management

CPU prompt processing is slow, so the prompt is kept small and stable:

```
[system]  Interviewer persona, rules, output schema (stable → Ollama reuses its cached prefix)
[context] Job title, level, type, difficulty, custom instructions (≤ 150 tokens)
          Candidate profile summary if resume/JD mode (pre-summarized once, ≤ 300 tokens)
          Topics already covered: 1-line summaries of previous Q&As (≤ 40 tokens each)
[current] Main question + any follow-ups so far + latest answer transcript (truncated to ~600 tokens)
```

- Question **selection** is deterministic code (planner), not the LLM. The LLM only phrases follow-ups and acknowledgments. This guarantees structure and prevents repeats: the planner excludes questions asked in this session and, by default, in your last N sessions.
- After each answered question, a one-line summary is produced as part of the same JSON response (`summary` field), so it costs no extra call.
- Adaptive difficulty (M12) uses a `quality_signal: weak|ok|strong` field from the same call.

## 5. Post-interview evaluation flow

```
session completed ─► jobs table: 1 row per answer (status=pending)
job runner (in-process, 1 job at a time, CPU-friendly) ─►
   build prompt: rubric (criteria + anchors) + question + expected points + transcript
   Ollama /api/chat  format=<JSON schema>  temperature 0.1  seed fixed  num_ctx 8192
   ─► Zod validate ─► (fail → 1 repair retry with error message) ─► (fail → status=failed, show retry)
   ─► evidence check: each quote must fuzzy-match the transcript, else flagged "unsupported"
   ─► overall = Σ(weight × criterion_score/4) × 100   (computed in code, not by the LLM)
   ─► save evaluation + criterion scores ─► update skill profile ─► notify UI (polling every 3 s)
```

Evaluation never runs while an interview turn is waiting on the LLM. The runner pauses when a session is `in_progress`.

## 6. Error handling and recovery

| Failure | Detection | Behavior |
|---------|-----------|----------|
| Mic permission denied or no device | `getUserMedia` error name | Explain how to enable it in browser settings; no recording happens |
| Mic disconnected mid-answer | `track.onended` | Auto-pause; keep transcribed segments; "Reconnect microphone" button |
| VAD model fails to load | promise rejection | Fall back to an energy-threshold detector plus the manual Done button |
| STT server down or timeout (15 s) | HTTP error | One automatic retry; supervisor restarts the child; segment audio kept **in memory** until retry succeeds or you skip |
| Empty or garbled transcript | heuristic | "Didn't catch that" (×2), then typed fallback |
| Ollama down or model missing | `/api/version`, 404 | Banner with the exact command; interview pauses; resume when healthy |
| LLM timeout or invalid JSON | timeout, Zod | Repair retry → deterministic fallback (`next` question); interview continues |
| Out of memory (Ollama killed) | connection reset | Same as Ollama down; Settings suggests the smaller fallback model |
| TTS failure | HTTP error | Show text and continue; optional browser `speechSynthesis` fallback |
| Browser reload or crash | session `in_progress` in DB | "Resume interview?" restarts at the last unanswered question |
| Evaluation failure | job status | Per-answer "Retry evaluation" button; other answers unaffected |

All component calls go through one `withTimeout + AbortController` helper. Errors are logged locally to `DATA_DIR/logs/app.log` (rotated, no transcripts in logs).
