# Shared helpers for scripts/*.sh. Source it, don't run it.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILS=0
WARNS=0
pass() { printf '  \e[32mPASS\e[0m  %s\n' "$*"; }
warn() { printf '  \e[33mWARN\e[0m  %s\n' "$*"; WARNS=$((WARNS + 1)); }
fail() { printf '  \e[31mFAIL\e[0m  %s\n' "$*"; FAILS=$((FAILS + 1)); }
info() { printf '  ....  %s\n' "$*"; }

load_env() {
  if [[ ! -f .env ]]; then
    echo ".env not found. Run: make setup" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
}

# Filesystem type of the nearest existing ancestor of a path.
fstype_of() {
  local p="$1"
  while [[ ! -e "$p" ]]; do p="$(dirname "$p")"; done
  findmnt -no FSTYPE -T "$p"
}

# Mount point of the nearest existing ancestor of a path.
mountpoint_of() {
  local p="$1"
  while [[ ! -e "$p" ]]; do p="$(dirname "$p")"; done
  findmnt -no TARGET -T "$p"
}
