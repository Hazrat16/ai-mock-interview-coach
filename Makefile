SHELL := /bin/bash
COMPOSE := docker compose
.DEFAULT_GOAL := help

.PHONY: help init doctor setup models up down status logs llm-smoke dev

help: ## List commands
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "}{printf "  make %-10s %s\n",$$1,$$2}'

init: ## Create .env and model/data folders (safe to re-run)
	@bash scripts/init.sh

doctor: ## Check machine and setup (PASS/WARN/FAIL)
	@bash scripts/doctor.sh

setup: ## Download container images (internet)
	$(COMPOSE) pull ollama

models: ## Download AI models into MODELS_DIR (internet, one-time)
	$(COMPOSE) --profile setup run --rm ollama-pull

up: ## Start services and wait until healthy
	$(COMPOSE) up -d --wait ollama

down: ## Stop and remove all containers (models and data are kept)
	$(COMPOSE) --profile setup down

status: ## Show services and their memory use
	@$(COMPOSE) ps
	@ids=$$($(COMPOSE) ps -q); [ -z "$$ids" ] || docker stats --no-stream $$ids

logs: ## Follow service logs
	$(COMPOSE) logs -f --tail=100

llm-smoke: ## M0 LLM check: JSON output, no thinking text, timings, isolation
	@bash scripts/llm-smoke.sh

dev: ## Run the app in development mode (arrives in M1)
	@echo "make dev is added in milestone M1."; exit 1
