#!/usr/bin/env bash
# M0 LLM smoke test: for each model, a cold and a warm run asking for JSON.
# Checks: valid JSON, no thinking text, timings, memory, cloud disabled, no internet from the container.
# Appends a report to docs/benchmarks/<date>-m0-llm-smoke.md
set -uo pipefail
source "$(dirname "$0")/lib.sh"
load_env

if [[ -z "$(docker compose ps -q --status running ollama)" ]]; then
  echo "ollama is not running. Run: make up" >&2
  exit 1
fi
for m in "$INTERVIEWER_MODEL" "$FALLBACK_MODEL"; do
  if [[ ! -f "$MODELS_DIR/ollama/manifests/registry.ollama.ai/library/${m%%:*}/${m#*:}" ]]; then
    echo "Model $m is not downloaded. Run: make models   (the ollama container has no internet, by design)" >&2
    exit 1
  fi
done
cid=$(docker compose ps -q ollama)
report="docs/benchmarks/$(date +%F)-m0-llm-smoke.md"
mkdir -p docs/benchmarks
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

prompt='You are a job interviewer. Reply with only a JSON object {"question": string, "skill": string} containing one behavioral interview question for a junior software engineer.'

{
  echo "# M0 LLM smoke test, $(date '+%F %T')"
  echo
  echo "- Ollama image: ollama/ollama:$OLLAMA_IMAGE_TAG, memory limit $OLLAMA_MEM_LIMIT"
  echo "- CPU: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs)"
  echo "- Power: $(for p in /sys/class/power_supply/*; do [[ $(cat "$p/type" 2>/dev/null) == Mains ]] && cat "$p/online"; done | head -1 | sed 's/1/on AC/;s/0/on battery/')"
  echo "- RAM available before: $(awk '/MemAvailable/ {printf "%.1f GB", $2/1048576}' /proc/meminfo)"
  echo
  echo "| model | run | load | prompt eval rate | eval rate | total | valid JSON | thinking text | container RAM |"
  echo "|---|---|---|---|---|---|---|---|---|"
} > "$tmp/report.md"

# Runs one prompt. Prints the response to $tmp/out and timing stats to $tmp/stats.
run_model() {
  local model=$1
  if ! docker compose exec -T ollama ollama run "$model" --think=false --format json --verbose "$prompt" </dev/null > "$tmp/raw" 2>&1; then
    if grep -qi 'does not support thinking' "$tmp/raw"; then
      docker compose exec -T ollama ollama run "$model" --format json --verbose "$prompt" </dev/null > "$tmp/raw" 2>&1 || return 1
    else
      return 1
    fi
  fi
  # The CLI writes spinner frames and terminal escape codes even without a TTY; strip them.
  sed -E $'s/\x1b\\[[0-9;?]*[A-Za-z]//g; s/\r//g; s/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]//g; s/total duration:/\\ntotal duration:/' "$tmp/raw" > "$tmp/clean"
  # --verbose appends timing lines after the response
  awk '/^ *total duration:/{s=1} s' "$tmp/clean" | sed 's/^ *//' > "$tmp/stats"
  awk '/^ *total duration:/{exit} {print}' "$tmp/clean" > "$tmp/out"
}

stat() { sed -n "s/^$1: *//p" "$tmp/stats" | head -1; }

for model in "$INTERVIEWER_MODEL" "$FALLBACK_MODEL"; do
  echo "== $model"
  docker compose exec -T ollama ollama stop "$model" </dev/null >/dev/null 2>&1 || true
  for run in cold warm; do
    if ! run_model "$model"; then
      fail "$model ($run): ollama run failed:"; sed 's/^/        /' "$tmp/raw" | tail -5
      echo "| $model | $run | error | | | | | | |" >> "$tmp/report.md"
      break
    fi
    if python3 -c 'import json,sys; json.loads(sys.stdin.read())' < "$tmp/out" 2>/dev/null; then json=yes; pass "$model ($run): valid JSON"
    else json=no; fail "$model ($run): output is not valid JSON"; fi
    if grep -qiE '<think>|thinking\.\.\.|\.\.\.done thinking' "$tmp/out"; then think=yes; fail "$model ($run): thinking text in output"
    else think=no; pass "$model ($run): no thinking text"; fi
    mem=$(docker stats --no-stream --format '{{.MemUsage}}' "$cid" | cut -d/ -f1 | xargs)
    info "load $(stat 'load duration'), prompt $(stat 'prompt eval rate'), gen $(stat 'eval rate'), total $(stat 'total duration'), RAM $mem"
    info "response: $(tr -d '\n' < "$tmp/out" | cut -c1-160)"
    echo "| $model | $run | $(stat 'load duration') | $(stat 'prompt eval rate') | $(stat 'eval rate') | $(stat 'total duration') | $json | $think | $mem |" >> "$tmp/report.md"
  done
  # Unload so the next model is measured cold and memory is not doubled.
  docker compose exec -T ollama ollama stop "$model" </dev/null >/dev/null 2>&1 || true
done

echo "== isolation"
# grep -c (not -q): -q exits early and the SIGPIPE would fail the pipeline under pipefail
if (( $(docker compose logs ollama 2>/dev/null | grep -ci 'cloud disabled: true') > 0 )); then cloud=yes; pass "Ollama log confirms cloud disabled"
else cloud=no; warn "log line 'cloud disabled: true' not found (check: docker compose logs ollama | grep -i cloud)"; fi

if docker compose exec -T ollama bash -c 'timeout 5 bash -c "</dev/tcp/1.1.1.1/443"' </dev/null >/dev/null 2>&1; then net="REACHABLE"; fail "ollama container can reach the internet"
else net="blocked"; pass "ollama container cannot reach the internet"; fi

{
  echo
  echo "- Cloud disabled in log: $cloud"
  echo "- Internet from ollama container: $net"
  echo "- RAM available after: $(awk '/MemAvailable/ {printf "%.1f GB", $2/1048576}' /proc/meminfo)"
  echo
} >> "$tmp/report.md"
cat "$tmp/report.md" >> "$report"
echo
echo "Report appended to $report"
(( FAILS == 0 ))
