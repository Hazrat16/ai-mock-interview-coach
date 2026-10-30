#!/usr/bin/env bash
# Desktop launcher (M15, R31). Installed by `make install-launcher` as a menu entry "AI Interview Coach".
#   start (default): starts the AI services and the app if they are not running, then opens the app in its own
#                    window (Chrome/Chromium app mode; otherwise the default browser).
#   stop:            stops the app and the AI services.
# The app keeps running after the window is closed; use the menu entry's "Stop" action (or this script) to stop it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Menu entries do not load your shell profile (nvm): the installer passes Node's folder.
[ -n "${COACH_NODE_DIR:-}" ] && export PATH="$COACH_NODE_DIR:$PATH"
# As in the Makefile: the Piper container runs as you, to read the voice files.
export HOST_UID="$(id -u)"

PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
PORT="${PORT:-4317}"
DATA_DIR="$(grep -E '^DATA_DIR=' .env | cut -d= -f2)"
URL="http://127.0.0.1:${PORT}"
LOG="$DATA_DIR/logs/app.log"
PIDFILE="$DATA_DIR/app.pid"
mkdir -p "$DATA_DIR/logs"

say() { command -v notify-send >/dev/null && notify-send -a "AI Interview Coach" "AI Interview Coach" "$1" || true; echo "$1"; }
fail() {
  say "$1 See $LOG"
  exit 1
}
running() { curl -sf -m 2 "$URL/api/health" >/dev/null; }

start() {
  if ! running; then
    say "Starting… (about 30 seconds)"
    docker compose up -d --wait >>"$LOG" 2>&1 || fail "The AI services did not start. Is Docker running?"
    # Build the page only when the code changed since the last build.
    if [ ! -f dist/web/index.html ] || [ -n "$(find web/src shared index.html -newer dist/web/index.html -print -quit 2>/dev/null)" ]; then
      npm run build >>"$LOG" 2>&1 || fail "Building the app failed."
    fi
    # Its own process group (setsid), so stop can end the app and every process it started at once.
    NODE_ENV=production setsid nohup node_modules/.bin/tsx server/src/index.ts >>"$LOG" 2>&1 </dev/null &
    echo $! >"$PIDFILE"
    for _ in $(seq 1 60); do
      running && break
      sleep 1
    done
    running || fail "The app did not start."
  fi
  for browser in google-chrome chromium chromium-browser brave-browser microsoft-edge; do
    if command -v "$browser" >/dev/null; then
      exec "$browser" --app="$URL" --class=ai-interview-coach >/dev/null 2>&1
    fi
  done
  exec xdg-open "$URL"
}

stop() {
  if [ -f "$PIDFILE" ]; then
    # tsx starts node: end the whole process group.
    kill -TERM -- "-$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
  docker compose down >>"$LOG" 2>&1 || true
  say "Stopped."
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  *)
    echo "usage: $0 [start|stop]" >&2
    exit 2
    ;;
esac
