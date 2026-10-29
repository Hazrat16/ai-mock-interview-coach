SHELL := /bin/bash
COMPOSE := docker compose
.DEFAULT_GOAL := help

.PHONY: help setup models dev start deps-up deps-down status logs test lint typecheck check doctor llm-smoke

help: ## List commands
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "}{printf "  make %-10s %s\n",$$1,$$2}'

setup: ## Create .env and folders, install npm packages, pull images (safe to re-run)
	@bash scripts/init.sh
	npm install
	$(COMPOSE) pull

models: deps-up ## Download the AI models (internet, one-time)
	@source scripts/lib.sh && load_env && for m in $$INTERVIEWER_MODEL $$FALLBACK_MODEL; do \
	  $(COMPOSE) exec ollama ollama pull "$$m" || exit 1; done

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
