# 11. Revision: Docker Compose + Makefile (approved 2026-10-29)

This revision **supersedes** the parts of documents 02–09 that describe host-installed services, child-process supervision, or moving the repository. Everything else (requirements, rubrics, schema, milestone order) still applies.

## Decisions
| ID | Decision |
|----|----------|
| D1 | Repository **stays on the NTFS drive**. `node_modules` lives inside the app container, not on NTFS. The database is bind-mounted from `~/.local/share/ai-interview-coach` (ext4). |
| D2 | English only (v1). |
| D3 | Headphones. |
| D4 | Disk freed with Docker cleanup: 22 GB free on `/` (measured 2026-10-29). |
| D5 | Docker Compose runs all services. A Makefile is the only interface (`make dev`, `make up`, `make down`, …). |
| D6 | Ollama image pinned to **`ollama/ollama:0.40.13`** (latest stable on 2026-10-29; amd64 digest `sha256:93c1376d…e2d`). Never `latest`. |

## Services (compose project `ai-interview-coach`)
| Service | Image | Networks | Host port | Added in |
|---------|-------|----------|-----------|----------|
| `ollama` | `ollama/ollama:0.40.13` | `ai-internal` only (no internet) | none | M0 |
| `ollama-pull` | same image, profile `setup`, one-off | `default` (internet, model downloads only) | none | M0 |
| `app` | built from `docker/app.Dockerfile` (Node 24) | `ai-internal` + `default` | `127.0.0.1:4317` | M1 |
| `piper` | built from `docker/piper.Dockerfile` | `ai-internal` only | none | M5 |
| `whisper` | built from `docker/whisper.Dockerfile` (whisper.cpp pinned tag) | `ai-internal` only | none | M6 |

- `ai-internal` is a Docker network with `internal: true`, so containers on it **cannot reach the internet**. All AI processing (LLM, STT, TTS) happens only in containers attached to this network alone, which enforces the privacy rule.
- The `app` container also joins `default` because a published port needs a non-internal network. Its outbound traffic is controlled by code review, CSP, the Playwright network guard, and `make net-audit`.
- Model files are bind mounts from `/media/hazrat/Hazrat8/ai-models/{ollama,whisper,piper}`. They use `create_host_path: false`, so if the NTFS drive is not mounted, the container fails to start instead of silently writing models to the root disk.
- `restart: "no"`: nothing starts at boot. `make down` stops everything.
- `ollama` has a memory limit (`OLLAMA_MEM_LIMIT`, default `7g`). If memory runs out, only that container is killed instead of the desktop freezing.

## What this replaces
- **04 §2 start/stop and `runtime/supervisor.ts`:** replaced by Compose health checks and `depends_on`. The app keeps `runtime/health.ts` to report the status of each service.
- **05:** adds `compose.yaml`, `Makefile`, and `docker/*.Dockerfile`. `tools/` (host builds) is no longer needed. `scripts/coach` is replaced by the Makefile.
- **07 M0:** no host installation of Ollama, cmake, or Python. See the updated M0 below.
- **09:** installation is `make init && make setup && make models && make up`.
- **10:** add Docker Engine (Apache-2.0, no account needed for public images) and Docker Compose (Apache-2.0).

## Updated M0: environment and Ollama in Docker
**Goal:** prove that this machine can run the LLM in Docker with models on the NTFS drive, offline, and measure first numbers.
**Files:** `.gitignore`, `.env.example`, `compose.yaml`, `Makefile`, `scripts/doctor.sh`, `scripts/llm-smoke.sh`, `README.md`.
**Commands:** `make init` → `make doctor` → `make setup` → `make models` → `make up` → `make llm-smoke` → `make down`.
**Acceptance:**
1. `make doctor` has no FAIL.
2. Both models are listed and stored on the NTFS drive.
3. `qwen3.5:4b` answers with valid JSON and without thinking text.
4. The Ollama log shows that cloud features are disabled.
5. The `ollama` container cannot reach the internet.
6. Load time, tokens/s, and memory are recorded in `docs/benchmarks/`.

## Known trade-offs
- VS Code TypeScript IntelliSense needs `node_modules` on the host. This is decided in M1 (options: VS Code Dev Containers, or a host `npm ci` for editor use only).
- The first image build downloads base images (internet needed once). After that, everything runs offline.
