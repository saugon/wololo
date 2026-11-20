.PHONY: help typecheck test validate app install release app-test check

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{ printf "  %-10s %s\n", $$1, $$2 }'

typecheck: ## Type-check the plugin (needs tsc)
	tsc -p .

test: ## Run the plugin's unit tests
	claude plugin test .

validate: ## Validate the plugin
	claude plugin validate .

app: ## Build Wololo.app in app/dist
	app/scripts/build-app.sh

install: ## Build Wololo.app and copy it to ~/Applications
	app/scripts/build-app.sh --install

release: ## Build Wololo.app universal and zip it in app/dist, for a GitHub release
	app/scripts/build-app.sh --release

app-test: ## Run Wololo's tests
	cd app && swift test

check: test validate app-test ## Run every test and validate
