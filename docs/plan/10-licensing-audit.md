# 10. Cost and Licensing Audit

**Target: $0 additional cost. Result: $0.** Nothing in the plan requires an account, an API key, a subscription, or paid hosting. All components below are free to use for personal, local, non-distributed use.

Verification column:
- **V**: verified today (2026-10-29) from the official repository, model card, or ollama.com page.
- **K**: from prior knowledge, to be re-verified in the milestone that introduces it (the license file is checked before installing).

I am not a lawyer; this is a practical audit, not legal advice.

## Runtime components

| Component | License | V/K | Account? | API key? | Recurring cost? | Sends data externally by default? |
|-----------|---------|-----|----------|----------|-----------------|------------------------------------|
| Ollama | MIT | K | No (only for optional cloud models, which we disable) | No | No | Local inference sends nothing ("we don't see your prompts or data when you run locally", V). Pulls contact ollama.com. Cloud features exist, so we set `OLLAMA_NO_CLOUD=1` (V) |
| `qwen3.5:4b` / `:2b` / `:9b` weights | Apache-2.0 | V (HF card) | No | No | No | No |
| `granite4:3b` weights | Apache-2.0 | V (ollama.com) | No | No | No | No |
| `gemma4` (alternative) | Apache-2.0 | V (HF card) | No | No | No | No |
| `ministral-3` (alternative) | Apache-2.0 | V (ollama.com) | No | No | No | No |
| whisper.cpp | MIT | V | No | No | No | No (model download script uses Hugging Face once) |
| Whisper model weights | MIT | K | No | No | No | No |
| Piper engine (`piper-tts`, OHF-Voice/piper1-gpl) | GPL-3.0 | V | No | No | No | No. Voice download script contacts Hugging Face once |
| Piper voice `en_US-lessac-*` | Dataset licensed **non-commercial research only, no redistribution** | V | – | – | – | **Not used** |
| Piper voice (chosen, e.g. `en_US-ljspeech`) | Per voice MODEL_CARD; LJ Speech dataset public domain | K → checked in M5 | No | No | No | No |
| Kokoro-82M (later option) | Apache-2.0 weights | V | No | No | No | No |
| Silero VAD model | MIT | K | No | No | No | No |
| `@ricky0123/vad-web` | ISC | K (repo page did not show the name) | No | No | No | **Examples load from jsDelivr CDN.** We self-host all assets (V: options exist) |
| onnxruntime-web | MIT | K | No | No | No | Same CDN caveat; self-hosted |
| Node.js | MIT | K | No | No | No | No |
| better-sqlite3 / SQLite | MIT / public domain | K | No | No | No | No |
| Fastify, Zod, pino | MIT | K | No | No | No | No |
| React, Vite, Tailwind CSS, shadcn/ui, Radix UI | MIT | K | No | No | No | No (the shadcn CLI fetches component source at **dev time** only) |
| Recharts | MIT | K | No | No | No | No |
| pdfjs-dist (resume import) | Apache-2.0 | K | No | No | No | No |
| `@fontsource/*` fonts (e.g. Inter) | SIL OFL 1.1 | K | No | No | No | No (self-hosted, never Google Fonts CDN) |

## Development-only components

| Component | License | V/K | Notes |
|-----------|---------|-----|-------|
| TypeScript, tsx, ESLint, Prettier, concurrently | Apache-2.0 / MIT | K | No telemetry at runtime |
| Vitest | MIT | K | |
| Playwright | Apache-2.0 | K | Downloads a Chromium build once at install time |
| axe-core | MPL-2.0 | K | Test-time only |
| CMake, GCC | BSD-3 / GPL | K | Build tools; no effect on your code |
| npm registry, GitHub, Hugging Face, ollama.com | – | – | Contacted **only** during install and updates |

## Notes and risks

1. **GPL-3.0 (Piper):** obligations apply to distribution. Running it as a separate local process for yourself creates no obligation. If you ever publish the app, distribute Piper separately or use Kokoro (Apache-2.0).
2. **Voice data licenses vary per voice.** M5 reads the MODEL_CARD of the selected voice before download and records it in `docs/benchmarks/`.
3. **Piper maintenance:** the Open Home Foundation is asking for maintainers (V). The engine is stable, and Kokoro is the planned fallback if Piper stops working on future Python versions.
4. **Ollama account and cloud:** never needed. `OLLAMA_NO_CLOUD=1` plus binding to `127.0.0.1`.
5. **Your Claude subscription** is used only by you, for help with development. The app never calls Anthropic or any other AI API.
6. **Electricity and wear:** the only real cost. CPU inference makes the laptop run hot during evaluations.
