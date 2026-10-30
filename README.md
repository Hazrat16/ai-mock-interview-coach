# AI Mock Interview Coach

A personal, audio-only mock interview app that runs entirely on this computer. It uses Ollama for the LLM, Piper for text-to-speech, and whisper.cpp for speech-to-text. There are no cloud services and no API keys.

Planning documents: [docs/plan/](docs/plan/00-README.md). Current milestone: **M11 (data management and privacy audit)**; M9 scoring calibration paused. Scoring is off (`shared/features.ts`): after an interview the report shows an interview-ready answer and the key points for each question.

## How it runs

- **Docker** runs the AI services (`compose.yaml`), bound to `127.0.0.1` only.
- **The app** (Fastify API + React UI) runs on the host with npm.
- **`make dev`** starts both. Ctrl+C stops everything, including the containers.

## Quick start

```bash
make setup      # .env, folders, npm install, docker images (internet, once)
make models     # download the AI models (internet, once, ~5.4 GB)
make voices     # download the Piper voices (internet, once, ~300 MB)
make stt-models # download the Whisper models (internet, once, ~890 MB)
make doctor     # check the machine
make dev        # open http://127.0.0.1:5173  (Ctrl+C stops all)
```

Other commands: `make start` (production build on http://127.0.0.1:4317), `make check` (lint, type-check, tests), `make llm-smoke` (quick LLM check), `make bench` (LLM benchmark, ~25 min), `make bench-tts` (voice speed), `make bench-stt` (speech recognition accuracy), `make e2e` (a full spoken interview in Chrome with a fake microphone, then its report), `make eval-smoke` (one real evaluation per interview type), `make calibrate` (scoring calibration, paused), `make net-audit` (lists any network connection leaving this computer; run it during an interview), `make help`.

## Where things live

| What                 | Where                                                    |
| -------------------- | -------------------------------------------------------- |
| AI models            | `MODELS_DIR` (default `/media/hazrat/Hazrat8/ai-models`) |
| Database, backups    | `DATA_DIR` (default `~/.local/share/ai-interview-coach`) |
| Spoken-audio cache   | `DATA_DIR/tts-cache` (interviewer sentences only)        |
| Your test recordings | `DATA_DIR/stt-samples` (only those you save in Settings) |
| Benchmarks           | `docs/benchmarks/`                                       |
