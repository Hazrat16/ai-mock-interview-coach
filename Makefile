SHELL := /bin/bash
COMPOSE := docker compose
# The Piper container runs as your user, so it can read the voice files on the drive.
export HOST_UID := $(shell id -u)
.DEFAULT_GOAL := help

.PHONY: install-launcher uninstall-launcher net-audit help setup models voices dev start deps-up deps-down status logs test lint typecheck check doctor llm-smoke bench bench-tts stt-models bench-stt e2e eval-smoke calibrate
LAUNCHER := $(HOME)/.local/share/applications/ai-interview-coach.desktop

help: ## List commands
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "}{printf "  make %-10s %s\n",$$1,$$2}'

setup: ## Create .env and folders, install npm packages, pull/build images (safe to re-run)
	@bash scripts/init.sh
	npm install
	$(COMPOSE) pull --ignore-buildable
	$(COMPOSE) build

models: ## Download the AI models (internet, one-time)
	$(COMPOSE) up -d --wait ollama
	@source scripts/lib.sh && load_env && for m in $$(printf '%s\n' $$INTERVIEWER_MODEL $$EVALUATOR_MODEL $$FALLBACK_MODEL | sort -u); do \
	  $(COMPOSE) exec ollama ollama pull "$$m" || exit 1; done

voices: ## Download the Piper voices (internet, one-time, ~300 MB; licenses in shared/voices.ts)
	npx tsx scripts/download-voices.ts

stt-models: ## Download the Whisper speech-to-text models (internet, one-time, ~890 MB)
	npx tsx scripts/download-stt.ts $(ARGS)

dev: deps-up ## Start everything for development; Ctrl+C stops it all
	@trap '$(COMPOSE) down' EXIT; npm run dev

start: deps-up ## Build and run the production app; Ctrl+C stops it all
	npm run build
	@trap '$(COMPOSE) down' EXIT; npm start

deps-up: ## Start Docker services only (waits until healthy)
	$(COMPOSE) up -d --wait

deps-down: ## Stop Docker services (models and data are kept)
	$(COMPOSE) down

status: ## Show services and their memory use
	@$(COMPOSE) ps
	@ids=$$($(COMPOSE) ps -q); [ -z "$$ids" ] || docker stats --no-stream $$ids

logs: ## Follow Docker service logs
	$(COMPOSE) logs -f --tail=100

test: ## Run automated tests
	npm test

lint: ## Lint the code
	npm run lint

typecheck: ## Type-check the code
	npm run typecheck

check: lint typecheck test ## Lint, type-check and test

doctor: ## Check machine and setup (PASS/WARN/FAIL)
	@bash scripts/doctor.sh

llm-smoke: ## LLM check: JSON output, no thinking text, timings
	@node scripts/llm-smoke.mjs

bench: deps-up ## LLM benchmark on realistic prompts (~20-30 min; ARGS="--quick" ~8 min)
	npx tsx scripts/bench-llm.ts $(ARGS)

bench-tts: deps-up ## Text-to-speech speed per voice (first-sentence latency, real-time factor)
	npx tsx scripts/bench-tts.ts $(ARGS)

bench-stt: deps-up ## Speech-to-text accuracy (WER) and speed per Whisper model (~10 min)
	npx tsx scripts/bench-stt.ts $(ARGS)

e2e: deps-up ## Spoken interview + its report in Chrome with a fake microphone (real models, ~6 min, own test database)
	mkdir -p test-results
	npx playwright test $(ARGS)

install-launcher: ## Add "AI Interview Coach" to the desktop menu (opens the app in its own window; "Stop" action)
	@mkdir -p $(HOME)/.local/share/applications $(HOME)/.local/share/icons/hicolor/scalable/apps
	@cp assets/ai-interview-coach.svg $(HOME)/.local/share/icons/hicolor/scalable/apps/ai-interview-coach.svg
	@printf '%s\n' '[Desktop Entry]' 'Type=Application' 'Name=AI Interview Coach' \
	  'Comment=Practise job interviews with a local AI interviewer' \
	  'Exec=env COACH_NODE_DIR=$(dir $(shell command -v node)) $(CURDIR)/scripts/coach-launch.sh start' \
	  'Icon=ai-interview-coach' 'Terminal=false' 'Categories=Education;' 'StartupWMClass=ai-interview-coach' \
	  'Actions=stop;' '' '[Desktop Action stop]' 'Name=Stop' \
	  'Exec=env COACH_NODE_DIR=$(dir $(shell command -v node)) $(CURDIR)/scripts/coach-launch.sh stop' \
	  > $(LAUNCHER)
	@desktop-file-validate $(LAUNCHER) 2>/dev/null || true
	@echo "Added to the menu: $(LAUNCHER) (remove with: make uninstall-launcher)"

uninstall-launcher: ## Remove the desktop menu entry
	rm -f $(LAUNCHER) $(HOME)/.local/share/icons/hicolor/scalable/apps/ai-interview-coach.svg

net-audit: ## Privacy check: lists network connections leaving this computer (run during an interview; ARGS="--seconds 60")
	npx tsx scripts/net-audit.ts $(ARGS)

calibrate: deps-up ## Scoring consistency on the golden answer set (full run ~9 h, resumable; ARGS="--reps 1 --limit 2" for a quick pass)
	npx tsx scripts/calibrate-eval.ts $(ARGS)

eval-smoke: deps-up ## One real answer evaluation per interview type (~10 min)
	npx tsx scripts/eval-smoke.ts $(ARGS)
