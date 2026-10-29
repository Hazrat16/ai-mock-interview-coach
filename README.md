# AI Mock Interview Coach

A personal, audio-only mock interview app that runs entirely on this computer. It uses Ollama for the LLM, whisper.cpp for speech-to-text, and Piper for text-to-speech, all in Docker. There are no cloud services and no API keys.

Planning documents: [docs/plan/](docs/plan/00-README.md). Current milestone: **M0 (environment)**.

## Quick start

```bash
make init       # create .env and folders (safe to re-run)
make doctor     # check the machine
make setup      # download container images (internet, once)
make models     # download AI models (internet, once, ~6 GB)
make up         # start services
make llm-smoke  # test the LLM
make down       # stop everything
```

Run `make help` for all commands.
