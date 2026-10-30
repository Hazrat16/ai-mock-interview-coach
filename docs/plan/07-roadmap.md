# 07. Milestone Roadmap

Each milestone leaves the app runnable. The MVP is complete at **M8**. Typical size: one focused session, sometimes two.

Every milestone ends with this **Definition of Done**:
- `npm run lint && npm run typecheck && npm test` pass (from M1 onward).
- The milestone's manual verification steps were done by you, and I saw the output.
- Acceptance criteria are checked off.
- The README or `docs/` is updated if commands changed.
- A git commit is made, if you want one.

| # | Milestone | Leaves you with |
|---|-----------|-----------------|
| M0 | Machine preparation and environment check | Verified toolchain, Ollama + model working from the CLI |
| M1 | App skeleton | Web app on localhost with a health page |
| M2 | Database and settings | Persistent settings, migrations, backups |
| M3 | Ollama integration and LLM benchmark | Model chosen from **measured** numbers |
| M4 | Text-mode interview engine | Complete interview by typing (development harness) |
| M5 | Local TTS | Interviewer speaks |
| M6 | Local STT | Audio file → transcript, benchmarked |
| M7 | Live microphone, VAD, turn-taking | **First full audio interview** |
| M8 | Evaluation and reports | **MVP complete** |
| M9 | Scoring consistency harness | Measured score reliability |
| M10 | History and dashboard | Search, trends, skills |
| M11 | Data management and privacy audit | Export, backup, restore, delete; offline proof |
| M12 | Adaptive, retry, weakness, goals | Learning loop |
| M13 | Job description and resume interviews | Personalized interviews |
| M14 | Company-specific preparation | Provenance-labeled company prep |
| M15 | Assessment mode, accessibility, launcher | Polished v1 |

---

## M0. Machine preparation and environment check
**Goal:** make sure this computer can run every component before any app code exists.
**Dependencies:** your decisions D1–D4 (see 00-README).
**Files:** `scripts/doctor.sh`, `.nvmrc`, `.gitignore`, `README.md` (stub).
**Tasks and commands** (I will explain each step first. The `sudo` commands change your system):
1. Free space on `/` (see 02 §3); target ≥ 10 GB free. `df -h /`
2. If D1 is "move": `mkdir -p ~/code && cp -r <current>/docs ~/code/ai-mock-interview-coach/`. Copying keeps the original; nothing is deleted.
3. `git init`; Node: `nvm install 24 && nvm use 24 && node -v`
4. `sudo apt install -y build-essential cmake python3-venv sqlite3` (ffmpeg optional: `sudo apt install ffmpeg`)
5. Install Ollama following the **official manual Linux instructions** at docs.ollama.com/linux (exact archive name checked on the day). Then:
   - `sudo systemctl disable --now ollama` if the installer created a service. It will be started on demand.
   - `mkdir -p /media/hazrat/Hazrat8/ai-models/ollama`
   - `OLLAMA_MODELS=/media/hazrat/Hazrat8/ai-models/ollama OLLAMA_NO_CLOUD=1 ollama serve` in one terminal
   - `ollama pull qwen3.5:4b && ollama pull granite4:3b`
   - `ollama run qwen3.5:4b --think=false "Ask me one behavioral interview question."`
   - `ollama ps` shows memory use.
6. Memory facts: `sudo dmidecode -t memory | grep -E 'Type:|Speed:' | sort -u`
7. Mic test: `arecord -d 5 -f S16_LE -r 16000 /tmp/t.wav && aplay /tmp/t.wav`
8. `bash scripts/doctor.sh` prints a pass/fail table: node version, cmake, python venv, ollama reachable, models present, free RAM, free disk, DATA_DIR on ext4 (not fuseblk).

**Tests:** doctor script output (manual).
**Acceptance:** all doctor checks green; a model answers from the CLI; the first-response time is noted.
**Common failures:** `ollama: permission denied` on the NTFS folder (fix the mount options or folder owner); out of disk during pull; Node 26 still active (`nvm alias default 24`); the mic records silence (choose the correct input in `pavucontrol`).

## M1. App skeleton
**Goal:** a minimal local web app showing component health.
**Files:** `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.env.example`, `server/src/{index,env,logger}.ts`, `server/src/runtime/health.ts`, `server/src/routes/health.ts`, `web/src/{main,App,router}.tsx`, `web/src/pages/Settings.tsx`, `components/ui/*` (shadcn init), `shared/schemas/health.ts`.
**Tasks:** scaffold Vite React TS, Tailwind, and shadcn/ui; Fastify serving `/api/health` (Ollama reachable? free RAM?); dev mode = Vite + `tsx watch` via `concurrently`; prod = Fastify serves `dist/web`; self-hosted font; strict CSP header (`connect-src 'self'`); bind 127.0.0.1 only.
**Commands:** `npm install`, `npm run dev`, `npm run build && npm start`, `npm test`.
**Tests:** unit test for `env.ts` validation; `fastify.inject` test for `/api/health` with Ollama mocked as up and as down.
**Manual:** open `http://127.0.0.1:4317`, see the Settings page with a green Ollama status; stop Ollama → red with a hint.
**Acceptance:** dev and prod modes both work; no request leaves localhost (DevTools Network tab); the server is unreachable from another device on your LAN.
**Failures:** native-module build errors (wrong Node version); port in use; shadcn CLI needs network at **dev time only** (acceptable; it is not used at runtime).

## M2. Database and settings
**Goal:** durable local storage.
**Files:** `server/src/db/{connection,migrate}.ts`, `migrations/0001_init.sql`, `repos/settings.ts`, `routes/settings.ts`, `data/backup.ts`, Settings page form.
**Tasks:** pragmas; migration runner with pre-migration backup; settings get/put with Zod; a "Back up now" button; refuse to start if DATA_DIR is on a FUSE filesystem (check `/proc/mounts`).
**Tests:** migrations on an empty database; a migration failure rolls back; settings round-trip; the backup file opens and has identical row counts.
**Manual:** change a setting, restart, still there; `sqlite3 ~/.local/share/ai-interview-coach/coach.db '.tables'`.
**Acceptance:** schema matches 06; restart persistence; backup works.
**Failures:** `SQLITE_BUSY` (check busy_timeout); database placed on NTFS (guard prevents it).

## M3. Ollama integration and LLM benchmark
**Goal:** a reliable LLM client and a model choice based on real numbers.
**Files:** `server/src/llm/{ollamaClient,structured}.ts`, `scripts/bench-llm.ts`, `model_configs` repo, Settings model picker.
**Tasks:** chat and structured calls with `format` JSON schema, `think:false`, timeouts and abort, one repair retry; read Ollama timing fields (`load_duration`, `prompt_eval_count/duration`, `eval_count/duration`); "pull command" hint when a model is missing; benchmark script (see 08 §3).
**Commands:** `npm run bench:llm -- --models qwen3.5:4b,granite4:3b --threads 4,6,8,10 --runs 3`
**Tests:** structured-call tests against a **fake Ollama** server (valid, invalid, slow, 404); a live opt-in test `npm run test:live`.
**Manual:** review the benchmark table together and pick the primary model and `num_thread`.
**Acceptance:** JSON validity ≥ 95 % across 20 structured runs for the chosen model; the follow-up-style prompt answers in ≤ 10 s (warm), or we pick the faster model; results are saved to `docs/benchmarks/YYYY-MM-DD.md`.
**Failures:** thinking text leaks into output (check `think:false` support for the tag); OOM with the 9B model; slow cold load from NTFS.

## M4. Text-mode interview engine
**Goal:** the full interview logic, testable without audio.
**Files:** `seed/questions/*.json` (~150 questions across types and levels), `repos/{questions,configs,sessions,turns,answers}.ts`, `interview/{engine,planner,followUp,context}.ts`, `llm/prompts/interviewer.ts`, routes for configs, sessions, and turns; pages `NewInterview.tsx`, `Interview.tsx` (text mode), `web/src/interview/turnMachine.ts`.
**Tasks:** setup form (R1); seeded planner with no repeats; follow-up decision JSON (`ack`, `action`, `follow_up`, `summary`, `quality_signal`) with a deterministic fallback; resume an in-progress session after reload; option to generate missing questions (stored with `source='generated'`).
**Tests:** planner (filters, seed determinism, no repeats, too-few-questions path); turnMachine reducer; engine with fake LLM (follow-up limit respected, fallback on invalid JSON); integration test: full session via `inject`.
**Manual:** a 3-question behavioral interview by typing; reload mid-way → resume.
**Acceptance:** R1, R4 (text), R6, R10 met.
**Failures:** the LLM asks a new main question instead of a follow-up (prompt plus a schema enum); the follow-up repeats the question (check a similarity guard).

## M5. Local text-to-speech
**Goal:** the interviewer speaks.
**Files:** `scripts/setup-piper.sh`, `runtime/supervisor.ts`, `speech/{ttsClient,sentenceSplit,phraseCache}.ts`, `routes/speech.ts`, `web/src/audio/player.ts`, Interview page.
**Tasks:** venv + `pip install "piper-tts[http]"`; **check the chosen voice's MODEL_CARD license before download**; supervise the Piper server; sentence pipelining; phrase cache; voice and speed settings; `scripts/bench-tts.ts`.
**Tests:** sentence splitter (abbreviations, code terms like "O(n log n)"); supervisor restart logic with a fake child; live TTS returns a valid WAV header.
**Manual:** the text-mode interview now speaks questions; kill the Piper process → it restarts and the interview continues.
**Acceptance:** R2; first-sentence latency measured and recorded.
**Failures:** Python 3.10 incompatibility (pin the piper-tts version); no audio (browser autoplay policy, so start audio from a user click); wrong sample rate.

## M6. Local speech-to-text
**Goal:** reliable transcription of audio files.
**Files:** `scripts/setup-whisper.sh` (pinned release tag, build, model download with SHA check), supervisor entry, `speech/sttClient.ts`, `POST /api/stt`, `scripts/bench-stt.ts`, `server/test/fixtures/audio/`.
**Tasks:** build `whisper-server`; run with `--host 127.0.0.1`; use `verbose_json` for segments and `no_speech_prob`; a **loopback accuracy test**: Piper speaks known sentences, Whisper transcribes them, word error rate is computed; also 3–5 recordings of your own voice.
**Commands:** `bash scripts/setup-whisper.sh base.en`, `npm run bench:stt -- --models base.en,small.en`
**Tests:** WAV encoder; confidence filtering; WER below threshold on fixtures (live test).
**Acceptance:** WER ≤ 15 % on your own recordings with the chosen model; 30 s of audio transcribed in ≤ 5 s (or we keep `base.en`).
**Failures:** cmake not found; AVX flags (auto-detected); wrong sample rate (must be 16 kHz mono).

## M7. Live microphone, VAD, turn-taking
**Goal:** the first full hands-free audio interview.
**Files:** `scripts/copy-vad-assets.mjs`, `web/public/vad/`, `web/src/audio/{mic,vad,wav}.ts`, `components/interview/*`, `turnMachine.ts` extended, `delivery.ts`.
**Tasks:** permission flow; recording indicator; segment-wise STT while speaking; end-of-answer logic (Done, Space, silence countdown, max length); thinking time; pause, resume, repeat, skip, end; transcript toggle; "didn't catch that" flow; all recovery paths in 04 §6; delivery metrics.
**Tests:** turnMachine for every control in every state; Playwright e2e with a fake mic WAV covering an answer, follow-up, and next question; an e2e test asserting that **every request goes to 127.0.0.1**.
**Manual (with the laptop speakers, D3):** a 3-question interview; deny the permission once; unplug the headset mid-answer; stop whisper mid-session.
**Acceptance:** R3, R4, R5 met; end-to-end turn latency measured and recorded.
**Implemented as (M7):** the VAD files are served by the app server from `node_modules` at `/vad/` (Vite proxies it in development, because Vite refuses module imports from `public/`), not copied by a script. The e2e test runs in the installed Google Chrome with its fake-microphone flag.
**Failures:** VAD assets 404 (check `/vad/` route); the VAD cuts sentences (raise `redemptionMs`); TTS heard by the mic (mic closed during TTS, short pause after TTS ends, echo cancellation on); AudioContext suspended until user gesture.

## M8. Evaluation and reports (**MVP**)
**Files:** `evaluation/rubrics/*.ts`, `evaluator.ts`, `scoring.ts`, `evidence.ts`, `jobRunner.ts`, `llm/prompts/evaluator.ts`, `shared/schemas/evaluation.ts`, `routes/evaluations.ts`, `pages/Report.tsx`, `components/report/*`.
**Tasks:** rubrics with anchors and weights; JSON schema; job queue (pauses during live sessions, resumes after restart); deterministic overall score; evidence verification; report with disclaimer and delivery metrics in a separate panel; retry a failed evaluation.
**Tests:** scoring math; rubric weights sum to 1; evidence fuzzy matching; schema rejects out-of-range values; job runner survives a simulated crash; live: one real evaluation per interview type.
**Acceptance:** R7, R8, R9 met; evaluation time per answer recorded.
**Implemented as (M8):** one evaluation per main question *including its follow-ups* (scoring a follow-up answer alone against the full rubric would be unfair); skill-profile updates are left to M10, which reads `evaluation_scores.skill_key`. Results: [docs/benchmarks/2026-10-30-evaluation.md](../benchmarks/2026-10-30-evaluation.md).

**Fixes after the first real use (M8):** "Sorry, I don't understand the question" (short replies asking to repeat or explain) is no longer taken as an answer: the interviewer rewords the same question (granite, 3.5-7 s; fixed rewordings for the fixed probes), at most twice per question. The fixed probes now depend on the interview type (technical questions no longer get "what you did yourself"). Evaluation prompt v2 for misheard technical terms. Speech check gained technical sentences, and `make bench-stt` compares fixes on your recordings.
**Failures:** truncated JSON (raise `num_predict`); hallucinated quotes (flagged); evaluation too slow (shorter example answer, fallback model).

## M9. Scoring consistency harness
**Files:** `server/test/fixtures/golden-answers/*.json` (≥ 5 questions per type × strong/medium/weak), `scripts/calibrate-eval.ts`.
**Tasks and acceptance:** see 08 §2. Rubric anchors are tuned until the targets are met; results are saved to `docs/benchmarks/`.
**Status: paused (2026-10-30).** Scores are hidden (`SHOW_SCORES = false`); the report shows interview-ready answers and key points. Scoring waits until speech-to-text handles technical terms. Built: golden set, `make calibrate` (cached, resumable), prompt v3, the two code safeguards. Pilot results and two bugs it found (Ollama OOM, 300 s fetch cut-off): [docs/benchmarks/calibration-2026-10-30-qwen3.5-4b-pilot.md](../benchmarks/calibration-2026-10-30-qwen3.5-4b-pilot.md).
**Scoring off (`shared/features.ts`, `SCORING = false`):** the background job writes only the interview-ready answer (`evaluation/readyAnswer.ts`): ~37 s per question instead of 2-4 min (e2e: 60 s for 2 questions, was 186 s). Stored as an evaluation without a score, so Retry and the report work unchanged. Later milestones leave out score-based parts while scoring is off.

## M10. History and dashboard
**Files:** `0002_fts.sql`, `routes/{history,dashboard}.ts`, `learning/skillProfile.ts`, pages `Dashboard`, `History`, `Progress`, `components/charts/*`.
**Acceptance:** R12, R13; dashboard numbers equal to SQL computed independently in a test; empty states look right.
**Implemented as (M10, scoring off):** `0002_fts.sql` (FTS5 over the question as asked + the transcript, kept in sync by triggers, existing answers back-filled); `GET /api/history` (search by whole words or word starts, highlighted snippets, filters for type, level and dates that combine; the score filter waits for scoring); `GET /api/dashboard` (interviews, questions answered, practice time, interview types, topics from the bank's skill tags, delivery per interview). Pages Dashboard, History (filters kept in the address) and Progress (speaking pace, filler words and long pauses per interview; small SVG charts, no chart library). Left out while scoring is off: average and recent scores, per-skill scores, score trend, strengths and weaknesses (`learning/skillProfile.ts` not built). Tests: `server/test/integration/history.test.ts` (dashboard numbers against independently computed values, 0 and many interviews), `e2e/history.spec.ts`.
**Fix found by the e2e runs (M10):** Ollama got stuck (every request waiting, even for the loaded model) after model loads were cancelled midway. Requests asked for different context sizes (4096/8192), and each change reloads the model; all requests now use `NUM_CTX` (8192, `ollamaClient.ts`). Two e2e runs in a row without restarting Ollama passed.

## M11. Data management and privacy audit
**Files:** `data/{export,restore,purge}.ts`, `routes/data.ts`, Settings "Data & privacy" section, `scripts/net-audit.sh`.
**Tasks:** JSON export; backup and restore (version check; restore writes a safety backup first); delete per session, transcripts-only, all; optional audio retention with purge; **offline run** (09 §6).
**Acceptance:** R14, R15; backup → delete all → restore gives identical checksums; `net-audit.sh` shows zero non-loopback connections during an interview.
**Risk callout:** restore and delete-all overwrite data. The UI requires typing a confirmation word, and restore always makes a safety backup first.

## M12. Adaptive difficulty, retry, weakness focus, exercises, goals
**Acceptance:** R17–R20. The planner explains every selection ("chosen because: trade-off reasoning avg 48 over 4 attempts").

## M13. Job description and resume interviews
**Files:** `documents/{pdfText,summarize}.ts`, `interview/modes/{jd,resume}.ts`, Documents UI.
**Acceptance:** R21, R22; PDF parsing works offline; prompts contain the summary (≤ 300 tokens), not the full document.

## M14. Company-specific preparation
**Acceptance:** R23. Every company item displays "Verified by you (source, date)" or "Generated prediction, not verified". There is no runtime web access.

## M15. Assessment mode, accessibility, launcher
**Tasks:** skill taxonomy per job family; assessment coverage plan; axe-core accessibility checks in Playwright; keyboard-only run-through; `.desktop` launcher opening an app-mode browser window.
**Acceptance:** R24, R31; zero critical axe violations.

## Later / experimental backlog
Kokoro voice (R27), streaming captions (R25), barge-in (R26), voice commands (R29), Vulkan iGPU benchmark (R30), sherpa-onnx Parakeet STT, code editor panel (R28).
