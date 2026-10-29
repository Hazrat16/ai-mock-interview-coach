#!/usr/bin/env bash
# Creates .env (if missing) and the model/data folders. Never overwrites or deletes anything.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

if [[ -f .env ]]; then
  info ".env already exists (left unchanged)"
else
  sed "s|__HOME__|$HOME|g" .env.example > .env
  pass "created .env from .env.example"
fi
load_env

if [[ "$(mountpoint_of "$MODELS_DIR")" == "/" ]]; then
  fail "MODELS_DIR ($MODELS_DIR) is on the root disk. Is the NTFS drive mounted? Open it in the file manager, then re-run."
  exit 1
fi
mkdir -p "$MODELS_DIR"/{ollama,whisper,piper}
pass "model folders ready in $MODELS_DIR"

case "$(fstype_of "$DATA_DIR")" in
  fuse*|ntfs*|vfat|exfat)
    fail "DATA_DIR ($DATA_DIR) is on $(fstype_of "$DATA_DIR"); SQLite needs ext4. Change DATA_DIR in .env."
    exit 1 ;;
esac
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"
pass "data folder ready in $DATA_DIR (private, mode 700)"
