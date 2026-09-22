# Claude AI Orchestration - course template. Every command the course pages
# and the marker quote is a target here; `make` alone lists them.
#
# The targets wrap the pnpm scripts in package.json ( pnpm is the native
# idiom for a TypeScript repository; make is the house front door ).

.DEFAULT_GOAL := help
.PHONY: help install verify tsc test-shipped test-gate proxy mcp-example mcp-mine pipeline decompose sandbox sandbox-pipeline sandbox-decompose sandbox-poll sandbox-decompose-github sandbox-logs sandbox-stop poll decompose-github

help: ## List all targets with their descriptions
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# Setup and checks --------------------------------------------------------------------------------

install: ## Install node dependencies ( needs Node 24+ and pnpm )
	pnpm install

verify: ## Typecheck + EVERY test - red at a fresh clone, green when the assignment is done
	pnpm verify

tsc: ## Typecheck only
	pnpm tsc:check

test-shipped: ## Only the shipped suites - green from the first clone
	pnpm test:shipped

test-gate: ## Only the two assignment suites - red until you are done
	pnpm test:gate

# The pieces you study ----------------------------------------------------------------------------

proxy: ## Start the logging proxy ( captures land in captures/ )
	pnpm proxy captures/

mcp-example: ## Run the example MCP server ( course-tools ) standalone on stdio
	pnpm mcp:example

mcp-mine: ## Run YOUR MCP server ( my-tools ) standalone on stdio
	pnpm mcp:mine

sandbox: ## Build ( first time ) and enter the docker sandbox - the ONLY place agents run
	./docker/run.sh

sandbox-pipeline: ## FILE pipeline in the sandbox, detached: the watcher ( logs: make sandbox-logs )
	./docker/run.sh -d make pipeline

sandbox-decompose: ## FILE pipeline in the sandbox: split REQS into queue jobs ( needs sandbox-pipeline running )
	docker exec -it claude-orchestration-poller make decompose REQS=$(REQS)

sandbox-poll: ## GitHub variant in the sandbox, detached: the poller ( logs: make sandbox-logs )
	./docker/run.sh -d make poll

sandbox-decompose-github: ## GitHub variant in the sandbox: raise REQS as labelled issues ( needs sandbox-poll running )
	docker exec -it claude-orchestration-poller make decompose-github REQS=$(REQS)

sandbox-logs: ## Follow the detached sandbox process's log
	docker logs -f claude-orchestration-poller

sandbox-stop: ## Stop the detached sandbox process
	-docker rm -f claude-orchestration-poller

# The FILE pipeline ( ships working ) - watcher FIRST, then decompose ----------------------------

REQS ?= requirements/version_toolkit_requirements.md

pipeline: ## FILE pipeline, terminal 1 - start this FIRST: watch the queue
	pnpm pipeline

decompose: ## FILE pipeline, terminal 2 - run once: split REQS into queue jobs ( make decompose REQS=<file> )
	pnpm decompose $(REQS)

# The GITHUB variant ( the assignment - YOU build it ) - poller FIRST, then decompose --------------

poll: ## GitHub variant, terminal 1 - start this FIRST: watch the issue queue ( YOU build this )
	@echo "build me: your GitHub-variant poller - see the assignment"; exit 1

decompose-github: ## GitHub variant, terminal 2 - run once: raise REQS as labelled issues ( YOU build this )
	@echo "build me: your GitHub-variant decomposer - see the assignment"; exit 1
