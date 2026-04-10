.PHONY: help compile package install clean dev

help: ## Show this help message
	@echo ''
	@echo 'LLM API Proxy - VS Code Extension'
	@echo '=================================='
	@echo ''
	@echo 'Usage: make <target>'
	@echo ''
	@echo 'Targets:'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@echo ''

compile: ## Compile TypeScript source
	npx tsc -p tsconfig.json

package: compile ## Package extension as .vsix
	npx @vscode/vsce package

install: package ## Install extension into VS Code
	@VSIX=$$(ls -t *.vsix 2>/dev/null | head -1); \
	if [ -z "$$VSIX" ]; then echo "Error: no .vsix file found"; exit 1; fi; \
	code --install-extension $$VSIX --force

clean: ## Remove build artifacts
	rm -rf out/ *.vsix

dev: ## Compile and watch for changes
	npx tsc -p tsconfig.json --watch
