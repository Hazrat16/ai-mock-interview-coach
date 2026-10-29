# 03. Technology Comparison

**Verification status.** "Verified 2026-10-29" means I checked the official repository, Hugging Face model card, or ollama.com page today. "From prior knowledge, re-check" means I did not open the source in this session; M0/M1 includes a step to confirm it. I have **not** run any benchmark on your machine. All speed statements are estimates until M3, M5, and M6.

## 1. Language model (via Ollama)

Ollama: MIT license (prior knowledge, re-check in M0). Verified 2026-10-29 from docs.ollama.com/faq: it binds `127.0.0.1:11434` by default, cloud features can be turned off with `OLLAMA_NO_CLOUD=1`, default context is 4096 tokens, and models stay loaded 5 minutes by default.

| Model tag | Download [Documented] | Est. RAM at 8K ctx | Est. CPU speed here | Quality for interviews & evaluation | JSON output | Context | License |
|-----------|----------------------|---------------------|---------------------|-------------------------------------|-------------|---------|---------|
| **`qwen3.5:4b`** | 3.3–4.0 GB | ~4.5–5.5 GB | medium | Strong for its size (Feb 2026 release); good instruction following | Good with Ollama `format` schema; **thinking must be disabled** (`think: false`) because it thinks by default and does not support `/nothink` | 256K native (we use 8K) | **Apache-2.0** (Verified, HF card) |
| **`granite4:3b`** | 2.1 GB | ~3–3.5 GB | fast | Solid, conservative; IBM targets instruction following and tool or structured use | Good (to measure) | 128K | **Apache-2.0** (Verified, ollama.com) |
| `qwen3.5:2b` | 2.7–3.1 GB | ~3.5–4 GB | fast | Noticeably weaker evaluation depth | OK | 256K | Apache-2.0 (same family card) |
| `qwen3.5:9b` | 6.6–7.6 GB | ~8–9 GB | slow (roughly 2× slower than 4B) | Best realistic quality here | Good | 256K | Apache-2.0 |
| `qwen3:4b` | 2.5 GB | ~3.5 GB | medium-fast | Good; text-only, older | Good | 256K | Apache-2.0 (prior knowledge, re-check) |
| `gemma4:e2b` | 4.6–7.5 GB | ~5–7 GB | medium | Good; multimodal weights inflate size with no benefit for us | Good | 128K | **Apache-2.0** (Verified, HF card) |
| `gemma4:e4b` | 6.6–9.5 GB | ~8–10 GB | slow | Good | Good | 128K | Apache-2.0 |
| `ministral-3:3b` / `:8b` | 3.0 / 6.0 GB | ~4 / ~7 GB | medium / slow | Good | Good | 256K | Apache-2.0 (Verified, ollama.com) |
| `granite4:tiny-h` (7B total, ~1B active MoE, hybrid Mamba) | not listed | to measure | potentially very fast per token | Unknown for this task | Unknown | 128K | Apache-2.0 |
| `qwen3:30b` (MoE ~3B active) | 19 GB | > available RAM | – | – | – | – | Rejected: does not fit |

**Recommendation**
- **Primary (interviewer + evaluator): `qwen3.5:4b`**, `think: false`, `temperature` 0.7 for the interviewer and 0.1 for the evaluator, `num_ctx` 8192. This is the best quality-to-speed balance that leaves memory for Whisper and the browser, under a permissive license.
- **Fallback: `granite4:3b`.** A different model family, so a template or format problem in one does not affect both. Smaller and faster.
- **Optional evaluation upgrade: `qwen3.5:9b`**, used only for post-interview evaluation, only if M3 shows it is under ~3 minutes per answer and memory allows it.
- The final choice is made from M3's measured numbers. The app makes the model a setting, never hard-coded.

Trade-off summary: each step up in size improves rubric reasoning and example answers, but roughly doubles evaluation time and memory. For the **live** path, speed matters more than depth, because the live task (a short follow-up) is easy.

## 2. Speech-to-text

| Option | License | Status | Fit |
|--------|---------|--------|-----|
| **whisper.cpp** `whisper-server` | MIT (Verified) | Active, ggml-org | C++ with no runtime dependencies; HTTP `/inference` endpoint; quantized models; `.en` models for English; optional built-in Silero VAD. Models: base 142 MiB / ~388 MB RAM, small 466 MiB / ~852 MB (Verified, README) |
| faster-whisper (CTranslate2) | MIT (prior knowledge) | Active | Good CPU speed, but adds a Python service; no clear gain over whisper.cpp here |
| sherpa-onnx (Parakeet TDT, Moonshine, Whisper) | Apache-2.0 code (prior knowledge); Parakeet weights CC-BY-4.0 | Active | Promising speed and accuracy; one Node addon could do STT + TTS + VAD. More moving parts to learn. **Candidate for later** |
| Vosk | Apache-2.0 | Maintained | Fast but clearly lower accuracy for free-form technical speech |
| Browser Web Speech API | – | – | **Rejected:** Chrome sends audio to Google servers |

**Choice: whisper.cpp `whisper-server` with `base.en`** (quantized). Switch to `small.en` if M6 shows it stays under ~5 s for the final segment. Whisper weights: MIT (OpenAI release, prior knowledge, re-check in M6).

## 3. Text-to-speech

| Option | License | Status | Fit |
|--------|---------|--------|-----|
| **Piper** (`piper-tts`, OHF-Voice/piper1-gpl) | **GPL-3.0** engine (Verified). Each voice has its own license | Active codebase but **the Open Home Foundation is asking for maintainers** (Verified). The original `rhasspy/piper` repo is superseded | Very fast on CPU; built-in HTTP server (`python -m piper.http_server`, POST `/synthesize` → WAV) (Verified) |
| Kokoro-82M | **Apache-2.0 weights** (Verified) | Active | Noticeably more natural; 54 voices, 8 languages. Slower than Piper on CPU (to measure). JS port `kokoro-js` exists (prior knowledge) |
| espeak-ng | GPL-3.0 | Maintained | Robotic; useful only as an emergency fallback |
| Browser `speechSynthesis` | – | – | Uses OS voices; on Linux usually espeak or Speech Dispatcher. Offline but low quality. Last-resort fallback |

**Voice licensing warning (Verified 2026-10-29):** Piper's popular `en_US-lessac` voices are trained on the Lessac Blizzard 2013 dataset, which is licensed for **non-commercial research only** and forbids redistribution. Even for personal use this is a gray area, so the plan **does not use lessac**. Instead it uses a voice whose dataset license is permissive (e.g. `en_US-ljspeech`; the LJ Speech dataset is public domain from prior knowledge, re-check in M5). The exact voice and its MODEL_CARD are checked in M5 before download.

**GPL-3.0 note:** you run Piper as a separate local process and do not distribute it, so GPL obligations (which apply to distribution) do not affect personal use.

**Choice: Piper HTTP server with a permissively licensed voice.** Kokoro is evaluated in a later milestone as a quality upgrade.

## 4. Voice activity detection

| Option | License | Fit |
|--------|---------|-----|
| **Silero VAD in the browser via `@ricky0123/vad-web`** (onnxruntime-web) | Silero VAD: MIT (prior knowledge); vad-web: ISC (prior knowledge, re-check: the repo page did not name it) | Runs on audio frames in the browser and emits speech start and end with audio. Ships Silero v5 and v6 models (Verified). **Its examples load assets from the jsDelivr CDN; we must self-host them** using `baseAssetPath` / `onnxWASMBasePath` (Verified) |
| whisper.cpp built-in `--vad` | MIT | Server-side only; useful as a second filter for silence inside a segment |
| WebRTC VAD | BSD | Older and noisier in practice |
| Energy threshold | – | Fallback if ONNX fails to load |

**Choice: vad-web (Silero v5) with self-hosted assets**, plus an energy-threshold fallback.

## 5. Database

| Option | Notes |
|--------|-------|
| **SQLite via `better-sqlite3`** (MIT) | Synchronous, fast, mature; FTS5 full-text search; online backup API. Native module, so pin Node to an LTS version |
| `node:sqlite` (built into Node) | Promising, but less mature; revisit later |
| ORM (Drizzle, Prisma) | Adds a build step and abstractions. Prisma brings a separate engine. Not needed for ~12 tables |

**Choice:** `better-sqlite3` + plain SQL migration files + Zod row validation. Database on ext4.

## 6. Frontend and backend

| Option | Pros | Cons for this project |
|--------|------|-----------------------|
| Next.js (App Router) | Popular; one framework for UI and API | Designed around server components and serverless request handling. Long-lived background jobs and child-process supervision fit poorly. Dev server uses ~1–2 GB RAM, which competes with the LLM. More framework behavior to reason about |
| **Vite + React + TypeScript SPA, Fastify server** | Single Node process serves the built SPA and API. Natural home for the job queue and process supervisor. Lightweight dev server. shadcn/ui officially supports Vite | Two configs (Vite and server), handled by one `package.json` |
| SvelteKit / plain HTML | Lighter | shadcn/ui and your stated preference point to React |
| Python (FastAPI) backend | Speech libraries are Python-native | A second language and runtime; Piper is the only Python piece and runs as its own process anyway |

**Choice: Vite + React + TS + Tailwind CSS + shadcn/ui (Radix) frontend; Fastify (MIT) backend; Zod (MIT) shared schemas; Recharts (MIT) for charts.** Fonts are self-hosted (`@fontsource`) so nothing is fetched from Google Fonts.

## 7. Process orchestration

**Choice:** the Fastify server is the single entry point. It checks for Ollama and starts `ollama serve` if it is not running, then spawns `whisper-server` and the Piper HTTP server as child processes bound to `127.0.0.1`, health-checks them, restarts a crashed child at most 3 times, and stops everything on exit. No systemd units, Docker, or PM2 needed.

## 8. Testing and packaging

| Need | Choice | License |
|------|--------|---------|
| Unit and integration | **Vitest** | MIT |
| HTTP route tests | Fastify `inject` | MIT |
| End-to-end | **Playwright** (Chromium with `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=answer.wav`, so recorded answers can be fed in automatically) | Apache-2.0 |
| Lint and format | ESLint + Prettier | MIT |
| Packaging | `npm run build` + `npm start`; `scripts/coach` start/stop/status/doctor; optional `.desktop` launcher. **No Docker** (unneeded overhead on 16 GB) | – |
