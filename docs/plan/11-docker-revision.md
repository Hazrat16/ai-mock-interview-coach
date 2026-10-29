# 11. Revision: Docker for services, app on the host, Makefile (approved 2026-10-29)

This revision **supersedes** the parts of documents 02–09 that describe host-installed services, child-process supervision, or moving the repository. Everything else (requirements, rubrics, schema, milestone order) still applies.

It follows the same pattern as the user's other dockerized projects (e.g. `ai-sql-assistant`): Docker runs the services, the app runs on the host with npm, and `make dev` starts everything while Ctrl+C stops it all.

## Decisions
| ID | Decision |
|----|----------|
| D1 | Repository stays on the NTFS drive; `node_modules` on the host works fine there. Only the SQLite file defaults to `~/.local/share/ai-interview-coach` (ext4), because SQLite locking is unreliable on FUSE mounts. |
| D2 | English only (v1). |
| D3 | Laptop speakers (revised 2026-10-30; was headphones). Mic closed while the interviewer speaks; browser echo cancellation on. |
| D4 | Disk freed with Docker cleanup (22 GB free on `/`, measured 2026-10-29). |
| D5 | Docker Compose runs the AI services. The app (Fastify + Vite/React) runs on the host via npm. The Makefile is the interface. |
| D6 | Ollama image pinned to **`ollama/ollama:0.40.13`** (latest stable on 2026-10-29). Never `latest`. |
| D7 | Host Node 26 (already installed); its built-in `node:sqlite` replaces better-sqlite3 (no native module). TypeScript **6.0.x**, because typescript-eslint does not yet support TypeScript 7. |
| D8 | Models from M3 measurements ([decision](../benchmarks/2026-10-29-model-decision.md)): **granite4:3b** for the live interview, **qwen3.5:4b** for evaluation, 8 CPU threads, one model in memory at a time. |

## Services
| Service | Image | Host port | Added in |
|---------|-------|-----------|----------|
| `ollama` | `ollama/ollama:0.40.13` | `127.0.0.1:11435` (11434 is used by other projects) | M0 |
| `piper` | built from `docker/piper.Dockerfile` (piper-tts 1.8.0, locked deps) | `127.0.0.1:5150` | M5 |
| `whisper` | built from `docker/whisper.Dockerfile` (whisper.cpp v1.9.5, static, tuned for this CPU) | `127.0.0.1:5160` | M6 |

The app listens on `127.0.0.1:4317`; in dev, Vite serves the UI on `127.0.0.1:5173` and proxies `/api`.

## Privacy trade-off (accepted)
Containers have normal Docker networking, so "no internet" is not enforced by Docker. Instead:
- Every port binds to `127.0.0.1` (verified in M1: not reachable from the LAN address).
- Ollama runs with `OLLAMA_NO_CLOUD=1` (verified via the log line).
- The UI has a same-origin-only Content Security Policy.
- From M11, `make net-audit` checks for outside connections during an interview.

## What this replaces
- **04 §2 start/stop and `runtime/supervisor.ts`:** replaced by Compose (`make deps-up` / `make deps-down`) plus the `make dev` / `make start` trap that stops containers on exit. The app keeps `runtime/health.ts`.
- **05:** adds `compose.yaml`, `Makefile`, and later `docker/*.Dockerfile`. `tools/` (host builds) and `scripts/coach` are not needed.
- **07 M0:** `make setup` → `make models` → `make llm-smoke`. No host install of Ollama, cmake, or Python.
- **09:** installation is `make setup && make models && make voices && make stt-models`, daily use is `make dev` or `make start`.
- **10:** add Docker Engine and Compose (Apache-2.0, no account needed for public images), `cn` (shadcn's class-name helper, MIT), and the Geist font via `@fontsource-variable/geist` (SIL OFL 1.1, self-hosted).
