#!/usr/bin/env bash
# Read-only environment check. Exit code 1 if any FAIL.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

echo "System"
grep -qw avx2 /proc/cpuinfo && pass "CPU supports AVX2 ($(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs))" \
  || warn "CPU has no AVX2; LLM will be very slow"

avail_gb=$(awk '/MemAvailable/ {printf "%.1f", $2/1048576}' /proc/meminfo)
if awk "BEGIN{exit !($avail_gb >= 6)}"; then pass "available RAM ${avail_gb} GB"
else warn "available RAM ${avail_gb} GB (< 6 GB): close browser tabs or stop other containers before interviews"; fi

root_free=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
if (( root_free >= 10 )); then pass "root disk free ${root_free} GB"
elif (( root_free >= 5 )); then warn "root disk free ${root_free} GB (< 10 GB)"
else fail "root disk free ${root_free} GB (< 5 GB): Docker images will not fit"; fi

echo "Docker"
if ! command -v docker >/dev/null; then fail "docker not installed"
elif ! docker info >/dev/null 2>&1; then fail "docker daemon not reachable (is it running? is $USER in the docker group?)"
else
  pass "docker $(docker version --format '{{.Server.Version}}')"
  docker compose version >/dev/null 2>&1 && pass "docker compose $(docker compose version --short)" || fail "docker compose plugin missing"
fi

echo "Node"
if command -v node >/dev/null; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  (( major >= 24 )) && pass "node $(node -v), npm $(npm -v)" || fail "node $(node -v) is too old; need 24 or newer (nvm install 24)"
  [[ -d node_modules ]] && pass "npm packages installed" || warn "npm packages not installed: run make setup"
else fail "node not installed (use nvm)"; fi

echo "Configuration"
if [[ ! -f .env ]]; then
  fail ".env missing: run make setup"
else
  load_env
  if [[ "$(mountpoint_of "$MODELS_DIR")" == "/" ]]; then fail "MODELS_DIR $MODELS_DIR is on the root disk (NTFS drive not mounted?)"
  elif [[ -d "$MODELS_DIR/ollama" ]]; then
    pass "MODELS_DIR $MODELS_DIR ($(fstype_of "$MODELS_DIR"), $(df -BG --output=avail "$MODELS_DIR" | tail -1 | xargs) free)"
  else fail "MODELS_DIR/ollama missing: run make setup"; fi

  fs=$(fstype_of "$DATA_DIR")
  case "$fs" in
    fuse*|ntfs*|vfat|exfat) fail "DATA_DIR $DATA_DIR is on $fs; SQLite needs ext4" ;;
    *) [[ -d "$DATA_DIR" ]] && pass "DATA_DIR $DATA_DIR ($fs)" || fail "DATA_DIR missing: run make setup" ;;
  esac

  if docker compose config -q 2>/dev/null; then pass "compose.yaml is valid"; else fail "compose.yaml invalid: run docker compose config"; fi

  if docker image inspect "ollama/ollama:$OLLAMA_IMAGE_TAG" >/dev/null 2>&1; then pass "image ollama/ollama:$OLLAMA_IMAGE_TAG present"
  else warn "image ollama/ollama:$OLLAMA_IMAGE_TAG not downloaded yet: run make setup"; fi

  for m in $INTERVIEWER_MODEL $FALLBACK_MODEL; do
    name=${m%%:*}; tag=${m#*:}
    if [[ -f "$MODELS_DIR/ollama/manifests/registry.ollama.ai/library/$name/$tag" ]]; then pass "model $m downloaded"
    else warn "model $m not downloaded yet: run make models"; fi
  done

  if [[ -n "$(docker compose ps -q --status running ollama 2>/dev/null)" ]]; then
    health=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q ollama)")
    [[ "$health" == healthy ]] && pass "ollama container running and healthy" || warn "ollama container is $health"
  else info "ollama container not running (start with make up)"; fi
fi

echo "Audio (host)"
if command -v pactl >/dev/null && pactl info >/dev/null 2>&1; then
  pass "sound server: $(pactl info | sed -n 's/^Server Name: //p')"
  src=$(pactl get-default-source 2>/dev/null) && info "default microphone: $src"
else warn "pactl not available; check the microphone in browser settings later"; fi

echo
if (( FAILS > 0 )); then echo "Result: $FAILS FAIL, $WARNS WARN"; exit 1; fi
echo "Result: no failures ($WARNS WARN)"
