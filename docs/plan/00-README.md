# AI Mock Interview Coach: Planning Package

Status: **APPROVED 2026-10-29**, with the Docker Compose + Makefile revision. See [11-docker-revision.md](11-docker-revision.md), which overrides the host-install details in 02–09.
Date: 2026-10-29

## Documents

| # | Document | What it answers |
|---|----------|-----------------|
| 01 | [Requirements](01-requirements.md) | What the app does, in priority tiers, with acceptance criteria |
| 02 | [Feasibility & hardware](02-feasibility-hardware.md) | Can this machine run it? Where are the bottlenecks? |
| 03 | [Technology comparison](03-technology-comparison.md) | Which components, and why |
| 04 | [Architecture & data flow](04-architecture-dataflow.md) | How the pieces talk, the audio turn loop, error recovery |
| 05 | [Project structure](05-project-structure.md) | Directories, modules, config, tests |
| 06 | [Database schema](06-database-schema.md) | Tables, relations, indexes, migrations, retention |
| 07 | [Roadmap](07-roadmap.md) | 16 sequential milestones (M0–M15) |
| 08 | [Testing & quality](08-testing-quality.md) | Test strategy, scoring consistency, benchmarks, privacy audit |
| 09 | [Install & operate](09-install-operate.md) | Setup, startup, offline check, troubleshooting, removal |
| 10 | [Cost & licensing audit](10-licensing-audit.md) | Every component: license, account, keys, costs, network |
| 11 | [Docker revision](11-docker-revision.md) | **Approved change:** Docker Compose + Makefile; supersedes host-install details |

## Your machine, as measured on 2026-10-29

| Item | Measured value | Impact |
|------|----------------|--------|
| OS | Ubuntu 22.04.5 LTS, kernel 6.8 | Fine |
| CPU | Intel Core i7-1355U (2 P-cores + 8 E-cores, 12 threads, AVX2 + AVX-VNNI) | **Main bottleneck.** 15 W laptop chip, sustained throughput limited by thermals |
| GPU | Intel Iris Xe (integrated) | Treated as CPU-only. Ollama's Vulkan iGPU path is an optional experiment (see 02) |
| RAM | 15 GiB total, **~5.4 GiB available** at measurement time (Chrome ~4 GB, clamd ~1 GB, mysqld ~0.4 GB, VS Code ~1.2 GB) | Must free memory before interviews |
| Root disk `/` (holds `/home`, `/usr`) | **7.5 GB free (93 % used)** | Too tight for default Ollama install + models |
| Project disk `/media/hazrat/Hazrat8` | 82 GB free, **NTFS via FUSE (`fuseblk`)** | Good for model files; unsafe for SQLite and slow for `node_modules` |
| Audio | PulseAudio, SOF HDA DSP, internal DMIC + analog jack | Works; headphones strongly recommended |
| Node | v26.11.1 (nvm installed) | Plan pins Node 24 LTS via `.nvmrc` (native-module compatibility) |
| Python | 3.10.12 | Sufficient for Piper TTS in a venv |
| Missing | ollama, cmake, sqlite3 CLI, ffmpeg (optional), pnpm (not needed) | Installed in M0 |

## Headline conclusions

1. **Feasible as a turn-based audio interview**, not as a real-time, interruptible conversation. Expect roughly **4–15 seconds** between finishing your answer and hearing the interviewer start to reply. This is an estimate that M3/M5/M6 will measure. Fully streaming barge-in conversation is listed as a later, experimental feature.
2. **Split "live" and "deep" AI work.** During the interview, the model only does small, fast tasks: deciding whether to ask a follow-up and phrasing it. The full rubric evaluation runs **after** the interview as a queued background job. That one decision is what makes this usable on a U-series CPU.
3. **Recommended stack:** React + Vite + TypeScript + Tailwind + shadcn/ui frontend, **Fastify** (Node) backend in one process, SQLite (better-sqlite3), Ollama, whisper.cpp `whisper-server`, Piper TTS (HTTP server), Silero VAD in the browser. **Next.js is evaluated but not recommended** (reasons in 03).
4. **Starting model: `qwen3.5:4b`** (Apache-2.0) with thinking disabled. **Fallback: `granite4:3b`** (Apache-2.0). **Optional quality tier for post-interview evaluation:** `qwen3.5:9b`, only if M3 benchmarks show acceptable speed and memory.
5. **Total additional cost: $0.** No accounts, API keys, or cloud inference. Ollama cloud features are explicitly disabled (`OLLAMA_NO_CLOUD=1`).

## Decisions I need from you at approval time

These materially affect setup. My recommendation is listed first.

- **D1. Where the code and data live.** Your current folder is on NTFS (FUSE).
  - *(Recommended)* Move the repo to ext4, e.g. `~/code/ai-mock-interview-coach`, after freeing ~10 GB on `/`. Keep **model files** on the NTFS drive (`/media/hazrat/Hazrat8/ai-models/`). Keep the **SQLite database** on ext4 (`~/.local/share/ai-interview-coach/`).
  - Alternative: keep the repo on NTFS (slower `npm install`, file-watching quirks). The database must still be on ext4. This is not optional, because SQLite file locking and WAL shared memory are unreliable on FUSE filesystems.
- **D2. Interview language.** ✅ Decided 2026-10-29: **English only** for v1 (enables the faster `*.en` Whisper models and an English voice).
- **D3. Headphones.** ✅ Decided 2026-10-29: **headphones will be used.** The mic stays closed while the interviewer speaks as an extra safeguard.
- **D4. Freeing disk space on `/`.** You need to free roughly 10 GB on the root partition, or accept installing the Ollama binary to the NTFS drive. M0 lists both paths.

## Things that cannot be known until measured on your machine

Memory type and bandwidth (largest factor in tokens per second), sustained versus burst CPU speed under thermal load, model load time from the NTFS drive, Whisper transcription speed, Piper synthesis speed, and whether the Iris Xe Vulkan path helps or crashes. M0 and M3 include the commands and benchmark scripts to measure each.

## Working agreement for implementation

One milestone per session. For each one I explain the goal, list prerequisites, give exact commands, implement only that milestone, run its tests, debug from real output, verify acceptance criteria, summarize, and **wait for your confirmation**. I will not mark anything as tested unless I ran it or you showed me the output. Any command that can delete or overwrite data is flagged before you run it.
