# 02. Feasibility and Hardware Assessment

**Verdict:** Feasible as a **turn-based** audio interview with post-interview evaluation, if memory is freed before practice and models are stored on the NTFS drive. A natural, real-time, interruptible conversation is **not** a realistic v1 target on a 15 W U-series CPU.

Labels used below: **[Measured]** = observed on your machine today. **[Documented]** = from official docs or model pages checked today. **[Estimate]** = my reasoning, to be replaced by M3/M5/M6 benchmark numbers.

## 1. CPU

- [Measured] i7-1355U: 2 performance cores + 8 efficiency cores, 12 threads, up to 5.0 GHz boost, AVX2 and AVX-VNNI (used by llama.cpp/ggml for faster int8 math).
- [Estimate] LLM token generation on CPU is mostly limited by **memory bandwidth**, not core count. For a ~3–4 GB quantized model, expect roughly **5–15 tokens/s** generation, and **~30–120 tokens/s** prompt processing. Prompt processing is the hidden cost: a 2,000-token evaluation prompt may take 20–60 s before the first output token.
- [Estimate] Thermal throttling: U-series chips boost briefly, then settle. Long evaluations will run slower than the first short test. Benchmark with sustained runs, plugged into AC power, with the power profile set to *Performance*.
- Thread count: E-cores are slower, and using all 12 threads can be *slower* than 4–6. M3 benchmarks `num_thread` = 4, 6, 8, 10.

## 2. Memory budget (16 GB machine)

| Component | Approx. RAM | Basis |
|-----------|-------------|-------|
| Ubuntu desktop + PulseAudio | 1.5–2.5 GB | Estimate |
| Browser with one app tab | 0.3–0.6 GB | Estimate |
| Node/Fastify server | 0.1–0.2 GB | Estimate |
| Ollama + `qwen3.5:4b` with 8K context | ~4–5.5 GB | Download size 3.3–4.0 GB [Documented] + KV cache and overhead [Estimate] |
| whisper.cpp `base.en` / `small.en` | ~0.4 / ~0.9 GB | [Documented] whisper.cpp README |
| Piper voice (medium) | ~0.1–0.2 GB | Estimate |
| **Total during an interview** | **~7–9.5 GB** | |

[Measured] Today only ~5.4 GB is free because Chrome (~4 GB across processes), ClamAV `clamd` (~1 GB), `mysqld` (~0.4 GB) and VS Code (~1.2 GB) are running. **Before practicing, close most Chrome tabs.** Optionally stop `clamd` and `mysqld` while practicing (`sudo systemctl stop clamav-daemon mysql`) and start them again afterwards. The app's Settings page will show free memory and warn when it drops below 6 GB.

Models that do **not** fit comfortably: `qwen3:30b` (19 GB), `gemma4:26b` (16–19 GB), `gpt-oss` 20B-class models. All exceed available RAM.

Swap is only 2 GB. If memory runs out, the system slows sharply or the OOM killer stops Ollama. The app treats "Ollama connection lost" as a recoverable error (see 04).

## 3. Disk

| Item | Size | Where |
|------|------|-------|
| Ollama binary + runtime libs | ~1–4 GB (the Linux bundle includes GPU libraries; unused CUDA/ROCm folders can be removed) | `/usr/local` or `~/opt` (root partition) |
| `qwen3.5:4b` + `granite4:3b` | ~5.5–6 GB [Documented] | **NTFS drive** `/media/hazrat/Hazrat8/ai-models/ollama` |
| optional `qwen3.5:9b` | 6.6–7.6 GB [Documented] | NTFS drive |
| Whisper `base.en` + `small.en` (ggml) | ~0.6 GB [Documented] | NTFS drive |
| Piper voice | ~60–120 MB | NTFS drive |
| whisper.cpp source + build | ~0.2 GB | `tools/` in the repo |
| Piper Python venv (onnxruntime) | ~0.3–0.5 GB | `tools/` in the repo |
| `node_modules` | ~0.4–0.8 GB | repo |
| SQLite database | < 50 MB for years of text | `~/.local/share/ai-interview-coach/` (ext4) |

[Measured] Root has 7.5 GB free (93 % used). Running a filesystem near full risks failed apt upgrades and app crashes. **Recommendation:** free about 10 GB on `/`. Run `sudo du -xh / --max-depth=2 | sort -h | tail -20` to see what is using space; common candidates are `~/.cache`, old snap revisions, Docker images (`docker system df`), and apt cache.

### Why NTFS matters
[Measured] The project drive is `fuseblk` (NTFS via FUSE).
- **SQLite:** file locking and WAL mode's shared-memory file are unreliable on FUSE. The database therefore always lives on ext4, regardless of decision D1.
- **Models:** large read-mostly files are fine on NTFS. The first model load may be slower because FUSE uses extra CPU. [Estimate] 10–40 s cold load for a 4 GB model; M3 measures it.
- **`node_modules`:** many small files plus symlinks are slow on FUSE. It works, but `npm install` and dev-server file watching are slower. This is the reason for recommending that the repo move to ext4.
- **Auto-mount:** the drive is mounted under `/media/hazrat/...` by the desktop session, which may happen after system services start. A systemd Ollama service could therefore start before its model folder exists. This is one reason the plan starts Ollama **on demand** from the app's start script instead of as an always-on service.

## 4. Audio

- [Measured] PulseAudio, internal digital microphone (DMIC) and analog headset jack.
- Browser capture (`getUserMedia`) works on `http://localhost` because localhost counts as a secure context.
- Laptop DMICs pick up fan and keyboard noise. Use a headset microphone if possible. Browser noise suppression is enabled and VAD thresholds are adjustable in Settings.
- Without headphones, TTS audio reaches the mic. The turn-based design closes the mic while the interviewer speaks, which avoids most of the problem; headphones are still recommended.
- Whisper may drop or "clean up" filler words ("um", "uh"). Filler counts are therefore labeled approximate and never used in content scoring.

## 5. Realistic latency per turn

From the moment you stop speaking to the moment you hear the interviewer:

| Step | [Estimate] range | Mitigation |
|------|------------------|------------|
| End-of-answer detection | 0 s (you click **Done**) to the configured silence (default 4 s) | Done button and Space key |
| STT of a 30–90 s answer | 1–6 s (`base.en`), 3–15 s (`small.en`) | Transcribe each speech segment **while you are still talking**, so only the last segment is pending at the end |
| LLM follow-up decision (~600 prompt tokens, ~60 output) | 3–10 s | Short prompt, Ollama keeps the model loaded, `think: false`, output capped |
| TTS of the first sentence | 0.2–1 s | Sentence-by-sentence synthesis and pre-synthesized fixed phrases |
| **Total** | **~4–15 s** | A short spoken acknowledgment ("Thanks, let me think about that.") plays immediately to cover the gap |

Post-interview evaluation, per answer: [Estimate] **30–120 s** with a 4B model, so a 6-question session needs ~3–12 minutes. The report fills in progressively, and you can close the browser while it runs (jobs persist in SQLite and resume).

## 6. Known vs. needs measurement

| Known now | Needs measurement (milestone) |
|-----------|------------------------------|
| CPU model, ISA extensions, core layout | Sustained tokens/s per model and `num_thread` (M3) |
| RAM total and current usage | Memory type and speed: `sudo dmidecode -t memory \| grep -E 'Type:\|Speed'` (M0) |
| Free disk per partition, filesystem types | Model cold-load time from NTFS (M3) |
| Audio devices | Mic quality and VAD thresholds in your room (M7) |
| Model download sizes and licenses (03, 10) | Whisper real-time factor for `base.en` vs `small.en` (M6) |
| Turn-based design is feasible | Piper synthesis speed; Kokoro speed if tried later (M5) |
| | JSON reliability of each candidate model (M3, M8) |
| | Whether Vulkan on Iris Xe helps or is stable (optional, later) |

## 7. Features that are limited by offline use or hardware

| Feature | Limitation | Free alternative in this plan |
|---------|------------|-------------------------------|
| Natural real-time conversation with interruptions | CPU cannot run STT + LLM + TTS concurrently at conversational speed | Turn-based flow with fast acknowledgments. Barge-in is a later experiment |
| Live per-answer evaluation | Takes 30–120 s per answer | Post-interview queued evaluation; a quick quality signal is computed live for adaptivity |
| Current company information | No internet at runtime | User-provided notes with source and date; generated predictions are labeled |
| Large high-quality models (≥ 14B) | RAM and speed | 4B model live; optional 9B for offline evaluation only |
| Typing code during coding interviews | Conflicts with audio-only goal | Verbal algorithm interviews; optional editor later |
