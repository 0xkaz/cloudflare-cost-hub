.PHONY: help lint typecheck test build check clean dev install

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

lint: ## Run linters
	npm run lint

typecheck: ## Type-check without emitting
	npm run typecheck

test: ## Run tests (unit + e2e)
	npm run test

test-unit: ## Run only unit tests
	npm run test -- tests/unit

test-e2e: ## Run only the API e2e tests
	npm run test -- tests/e2e

build: ## Build the project
	npm run build

check: lint typecheck test build ## Run the full pre-flight gate (lint + types + tests + build)

clean: ## Remove build artifacts
	rm -rf dist node_modules

dev: ## Start development servers
	npm run dev
