# 08. Testing and Quality Strategy

## Test layers

| Layer | Tool | Runs | Needs real models? |
|-------|------|------|--------------------|
| Unit | Vitest | `npm test` (every milestone) | No |
| Integration (routes + temp SQLite + fake Ollama/Whisper/Piper HTTP servers) | Vitest + `fastify.inject` | `npm test` | No |
| Live component | Vitest, tagged | `npm run test:live` (manual, slow) | Yes |
| End-to-end | Playwright + Chromium fake mic | `npm run test:e2e` | Optionally (fake or live mode) |
| Benchmarks | `scripts/bench-*.ts` | manual | Yes |
| Calibration | `scripts/calibrate-eval.ts` | manual, after rubric or model changes | Yes |

Fake servers return recorded fixtures, so CI-style runs are fast, deterministic, and offline.

## 1. Coverage by area

| Area | Tests |
|------|-------|
| Audio input and transcription | WAV encoder (header, 16 kHz mono); segment ordering when STT responses arrive out of order; `no_speech_prob` filtering; "didn't catch that" after an empty transcript; Playwright fake-mic answer → transcript visible; **Piper→Whisper loopback WER** and WER on your own recordings (live) |
| Speech playback | Sentence splitter edge cases; player queue (pause stops playback and clears the queue; repeat replays); TTS failure shows text and continues; WAV validity (live) |
| Model availability and failures | Fake Ollama: down, 404 model, slow (timeout), invalid JSON, truncated JSON, connection reset mid-stream → expected fallback; health endpoint states |
| Question selection | Filters; seed determinism; no repeats within a session and across the last N sessions; too-few-questions path; adaptive stepping never jumps more than one level |
| Interview context | Context builder stays under its token budget (estimate ≈ chars/4) with long answers; covered-topic summaries included; follow-up limit enforced; resume after reload continues at the right turn |
| Evaluation JSON | Zod schema accepts valid fixtures and rejects missing fields, out-of-range scores, and wrong criterion keys; repair retry path; failed → `failed` status |
| Scoring consistency | §2 |
| Session persistence | Full session via API → rows in every table; restart → same data; cascade delete removes all children (count = 0) |
| Backup and restore | Backup → mutate → restore → table checksums equal original; newer-version backup refused; restore makes a safety backup first |
| Offline behavior | §4 |
| Privacy and network | §4; plus "no audio files on disk after session when retention is off"; logs contain no transcript text (grep test) |

## 2. Scoring consistency and validity

Goal: scores should be **repeatable, ordered sensibly, and backed by evidence**. They do not need to be "true". Procedure (`npm run calibrate`):

1. **Golden set:** for each interview type, ≥ 5 questions × 3 hand-written answers (strong, medium, weak), each with an expected score band (e.g. strong 75–95, medium 45–70, weak 10–40). These are written once (I draft them, you review them) and committed.
2. **Repeatability:** score each answer 3× (temperature 0.1, fixed seed, then a different seed). Target: standard deviation of the overall score ≤ 7 points; criterion scores differ by ≤ 1 point in ≥ 90 % of cases.
3. **Ordering:** strong > medium > weak for ≥ 90 % of triples.
4. **Band hit rate:** ≥ 75 % of scores inside their expected band.
5. **Evidence grounding:** ≥ 95 % of quotes verified in the transcript.
6. **Delivery independence test:** the same content written three ways (clean; with "um, uh, like" fillers; with transcription-style typos) must score within 5 points of each other. This checks that the rubric does not penalize delivery or accent.
7. **Results** go to `docs/benchmarks/calibration-<date>-<model>.md`. Rerun when the model, prompt, or rubric changes; versions are stored on each evaluation.

Design safeguards against arbitrary scores:
- The LLM scores **criteria on a 0–4 anchored scale** (a narrow scale is more consistent than 0–100). Code computes the 0–100 overall score.
- Every criterion score requires an evidence quote, or the explicit marker "no evidence in answer" (which caps that criterion at 1).
- An answer under ~20 words cannot score above 30 (rule in code).
- The UI shows: "Practice score from a local AI model. It can be wrong and does not predict hiring outcomes." Rubric version and model are shown on every report.
- Trend charts only compare evaluations with the same rubric version, or mark the version change on the chart.

## 3. Local benchmark procedure

`npm run bench:llm -- --models qwen3.5:4b,granite4:3b --threads 4,6,8 --runs 3`

For each model × thread count:
1. **Cold load:** `POST /api/generate` with `keep_alive:0` beforehand to unload, then a tiny prompt; record `load_duration`.
2. **Live-path test:** the real follow-up prompt (~600 tokens in, ≤ 80 out, structured JSON); record prompt tokens/s = `prompt_eval_count / prompt_eval_duration`, generation tokens/s = `eval_count / eval_duration`, and wall time.
3. **Evaluation test:** a real evaluation prompt (~1,500–2,500 tokens in, ~600 out).
4. **Memory:** peak RSS of the Ollama runner process (sampled from `/proc/<pid>/status` VmRSS every 250 ms) plus `ollama ps` size; system `MemAvailable` before and after.
5. **JSON validity:** % of runs passing Zod.
6. Report the median of 3 runs; note whether on AC power and the CPU temperature from `sensors` if available.

Output is a Markdown table:

| model | threads | load s | prompt tok/s | gen tok/s | follow-up wall s | eval wall s | peak RSS GB | JSON ok |
|-------|---------|--------|--------------|-----------|------------------|-------------|-------------|---------|

Similar scripts: `bench:stt` (audio seconds ÷ processing seconds per model) and `bench:tts` (characters/s, first-sentence latency).

## 4. Offline and privacy verification

- **Static:** CSP `default-src 'self'; connect-src 'self'`; the build has no external URLs (`grep -rE 'https?://' dist/web` allowlist test); fonts and VAD assets self-hosted.
- **Bindings:** all four services listen on `127.0.0.1` only (`ss -ltnp` check in `doctor.sh`).
- **E2E network guard:** Playwright `page.on('request')` fails the test on any non-`127.0.0.1` URL.
- **Runtime audit:** `scripts/net-audit.sh` lists established TCP/UDP connections of the node, ollama, whisper-server, and python (piper) processes that are not loopback. Expect none.
- **Offline run:** see 09 §6.
- Ollama: `OLLAMA_NO_CLOUD=1`, and the log line `Ollama cloud disabled: true` is checked by `doctor.sh`.
