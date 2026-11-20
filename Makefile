.PHONY: help typecheck test validate app install app-test check

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

app-test: ## Run Wololo's tests
	cd app && swift test

check: test validate app-test ## Run every test and validate
