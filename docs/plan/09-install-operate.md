# 09. Installation and Operation Guide (target state)

This describes the finished setup. Each step is introduced in its milestone, where commands are confirmed against current official documentation before you run them.

## 1. Prerequisites
- Ubuntu 22.04+, ≥ 10 GB free on `/`, ~15 GB free on the model drive.
- `sudo apt install -y build-essential cmake git python3-venv sqlite3` (optional: `ffmpeg`, `lm-sensors`).
- Node 24 LTS via nvm: `nvm install 24 && nvm alias default 24`.
- A headset is recommended.

## 2. One-time install (internet required)
```bash
cd ~/code/ai-mock-interview-coach          # or your chosen location (decision D1)
cp .env.example .env                        # then edit paths if needed
npm ci
# Ollama: install per https://docs.ollama.com/linux (manual install), then disable autostart:
sudo systemctl disable --now ollama         # only if the installer created the service
export OLLAMA_MODELS=/media/hazrat/Hazrat8/ai-models/ollama
OLLAMA_NO_CLOUD=1 ollama serve &            # temporary, for pulling
ollama pull qwen3.5:4b
ollama pull granite4:3b
bash scripts/setup-whisper.sh base.en       # builds whisper.cpp, downloads model to ai-models/whisper
bash scripts/setup-piper.sh <voice-name>    # venv + piper-tts[http], voice to ai-models/piper
node scripts/copy-vad-assets.mjs            # self-host VAD/onnx files
npm run build
bash scripts/doctor.sh                      # everything should be green
```

## 3. Environment variables (`.env`)
| Variable | Default | Purpose |
|----------|---------|---------|
| `HOST` / `PORT` | `127.0.0.1` / `4317` | App server (never `0.0.0.0`) |
| `DATA_DIR` | `~/.local/share/ai-interview-coach` | Database, backups, logs. **Must be on ext4** |
| `MODELS_DIR` | `/media/hazrat/Hazrat8/ai-models` | Whisper and Piper model files |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | |
| `OLLAMA_MODELS` | `$MODELS_DIR/ollama` | Passed to `ollama serve` if the app starts it |
| `OLLAMA_NO_CLOUD` | `1` | Disables Ollama cloud features |
| `INTERVIEWER_MODEL` / `EVALUATOR_MODEL` | `qwen3.5:4b` | Initial values; changeable in Settings |
| `FALLBACK_MODEL` | `granite4:3b` | |
| `LLM_NUM_THREAD` | set from M3 benchmark | |
| `WHISPER_BIN` / `WHISPER_MODEL` / `WHISPER_PORT` | `tools/whisper.cpp/build/bin/whisper-server` / `$MODELS_DIR/whisper/ggml-base.en.bin` / `8178` | |
| `PIPER_PYTHON` / `PIPER_VOICE` / `PIPER_PORT` | `tools/piper-venv/bin/python` / chosen voice / `5002` | |
| `KEEP_AUDIO` | `false` | Raw-audio retention (off by default) |

## 4. Daily use
```bash
npm start            # or: scripts/coach start   → opens http://127.0.0.1:4317
# Ctrl+C or scripts/coach stop  → stops app, whisper, piper, and ollama (if the app started it)
scripts/coach status # what is running, memory use
```
Before practice: plug in AC power, close heavy browser tabs, and keep the speaker volume moderate (the mic stays closed while the interviewer speaks).

## 5. Troubleshooting
| Symptom | Check / fix |
|---------|-------------|
| "Ollama unreachable" | `curl 127.0.0.1:11434/api/version`; is the NTFS drive mounted? `ls $OLLAMA_MODELS` |
| "model not found" | `ollama list`; run the `ollama pull` command shown in Settings |
| Very slow replies or system freezing | `free -h`; close Chrome tabs; switch to `granite4:3b`; lower `num_ctx` |
| No mic or permission denied | Browser site settings → microphone → allow for 127.0.0.1; `pavucontrol` input device |
| Transcript empty | Mic level in `pavucontrol`; lower the VAD threshold in Settings; try a headset mic |
| Interviewer silent | Browser tab muted? Click once on the page (autoplay policy); `curl -X POST 127.0.0.1:5002/synthesize ...` |
| Database error at startup | Message prints the backup path; `DATA_DIR` must not be on NTFS |
| Port in use | `ss -ltnp \| grep 4317`; change `PORT` |
| Logs | `$DATA_DIR/logs/app.log` (no transcripts) |

## 6. Verify offline operation
1. Start the app once online, then stop it.
2. Disconnect: `nmcli radio wifi off` and unplug Ethernet (or `nmcli networking off`).
3. `npm start`, then run a complete 2-question interview and wait for its evaluation report.
4. In another terminal during the interview: `bash scripts/net-audit.sh`. It should list no non-loopback connections.
5. Reconnect: `nmcli networking on` / `nmcli radio wifi on`.

## 7. Updates (internet required, optional)
- App: `git pull && npm ci && npm run build`. Migrations run automatically after an automatic backup.
- Models: `ollama pull <tag>`. **Re-run `npm run calibrate`** because scores may shift.
- whisper.cpp: `bash scripts/setup-whisper.sh --update` (rebuilds a pinned newer tag).
- Piper: `tools/piper-venv/bin/pip install -U "piper-tts[http]"`.

## 8. Removal
⚠️ The steps marked *data* permanently delete your interview history. Export a backup first if you want to keep it.
```bash
scripts/coach stop
rm -rf ~/code/ai-mock-interview-coach                     # code, tools, venv
rm -rf ~/.local/share/ai-interview-coach                  # data: database, backups, logs
rm -rf /media/hazrat/Hazrat8/ai-models/{whisper,piper}    # speech models
OLLAMA_MODELS=... ollama rm qwen3.5:4b granite4:3b        # or delete ai-models/ollama
# Ollama itself: follow the "Uninstall" section of docs.ollama.com/linux
```
