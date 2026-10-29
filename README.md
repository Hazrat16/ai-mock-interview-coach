# AI Mock Interview Coach

A personal, audio-only mock interview app that runs entirely on this computer. It uses Ollama for the LLM and Piper for text-to-speech, and will add whisper.cpp for speech-to-text. There are no cloud services and no API keys.

Planning documents: [docs/plan/](docs/plan/00-README.md). Current milestone: **M5 (local text-to-speech)**.

## How it runs

- **Docker** runs the AI services (`compose.yaml`), bound to `127.0.0.1` only.
- **The app** (Fastify API + React UI) runs on the host with npm.
- **`make dev`** starts both. Ctrl+C stops everything, including the containers.

## Quick start

```bash
make setup      # .env, folders, npm install, docker images (internet, once)
make models     # download the AI models (internet, once, ~5.4 GB)
make voices     # download the Piper voices (internet, once, ~300 MB)
make doctor     # check the machine
make dev        # open http://127.0.0.1:5173  (Ctrl+C stops all)
```

Other commands: `make start` (production build on http://127.0.0.1:4317), `make check` (lint, type-check, tests), `make llm-smoke` (quick LLM check), `make bench` (LLM benchmark, ~25 min), `make bench-tts` (voice speed), `make help`.

## Where things live

| What               | Where                                                    |
| ------------------ | -------------------------------------------------------- |
| AI models          | `MODELS_DIR` (default `/media/hazrat/Hazrat8/ai-models`) |
| Database, backups  | `DATA_DIR` (default `~/.local/share/ai-interview-coach`) |
| Spoken-audio cache | `DATA_DIR/tts-cache` (interviewer sentences only)        |
| Benchmarks         | `docs/benchmarks/`                                       |
