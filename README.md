# Claude AI Orchestration — course template

The practice environment for the **Claude AI Orchestration** course. It ships
working, tested functionality you will study during the course and extend for
the marked assignment:

| Piece | Where | What it is |
|---|---|---|
| Docker sandbox | `docker/` | The safe-autonomy container: auto mode on, blast radius contained |
| Logging proxy | `proxy/logproxy.ts` | See every request/response between claude and the model |
| Example MCP server | `mcp/example-server.ts` | Two tools claude can call; wired in via `.mcp.json` |
| Orchestration pipeline | `orchestration/` | Decomposer → file queue → atomic claim → implementer |
| Agent definitions | `.claude/agents/` | The decomposer and implementer agents the pipeline runs |
| Tests | `tests/` | Green for everything above — `pnpm verify` |

## Getting started

1. **Create your own repository from this template.** On this repository's
   GitHub page click **Use this template → Create a new repository**. Name it
   `firstname-lastname-claude-ai-orchestration` (your own name), make it
   **private**, and invite the markers the course names.

2. **Clone it and install:**

```bash
git clone https://github.com/YOUR_USER/firstname-lastname-claude-ai-orchestration.git
cd firstname-lastname-claude-ai-orchestration
pnpm install
pnpm verify        # typecheck + all tests: everything shipped should be green
```

You need Node 24+ and pnpm (`npm install -g pnpm`), plus Docker Desktop for
the sandbox.

## The sandbox (safe autonomy)

Build and enter the container:

```bash
./docker/run.sh
```

The script maps this repository into the container **read-write, except the
control plane**: `orchestration/`, `.claude/`, `.mcp.json` and `docker/` are
re-mounted **read-only**. Inside the container, claude's auto mode can edit
the work tree and the queue but can never rewrite the orchestration itself,
the agent definitions, or this docker setup. The docker wall protects your
machine; the read-only mounts protect the system from its own agents.

On first use, log in **inside the container** (logins persist in a named
docker volume across runs):

```bash
claude          # follow the login flow, then exit claude
gh auth login   # for the GitHub half of the course
```

## The logging proxy

In one terminal (host or container):

```bash
pnpm proxy captures/
```

In another, point claude at it for one command:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8765 claude -p "Reply with exactly OK."
```

Each exchange lands in `captures/` as one JSON file holding the full request
and response. The proxy buffers streamed responses, so replies arrive all at
once — use it for short runs, not daily work.

## The example MCP server

`.mcp.json` wires `mcp/example-server.ts` into claude as `course-tools` — a
fresh clone already shows it under `/mcp` in a claude session, exposing
`roll_dice` (required typed input) and `count_letters`. The marked assignment
asks you to build **another** server of your own design alongside it.

## The pipeline

```bash
pnpm pipeline                       # terminal 1: watch the queue
pnpm decompose path/to/reqs.md      # terminal 2: split a requirements file into jobs
```

The decomposer agent splits the requirements into small files; the plumbing
drops each into `queue/small/dropped/` via an atomic rename; the watcher
claims each job by atomically moving it to `queue/small/processing/` and runs
the implementer agent on it; finished jobs land in `done/`, exhausted retries
in `failed/`. Every reliability property rests on one primitive — a rename
within one filesystem is atomic — and the tests in `tests/` prove the
mechanics without a single model call.

## Layout

```
.claude/agents/   agent definitions (control plane, read-only in the sandbox)
docker/           sandbox image + run script (read-only in the sandbox)
mcp/              the example MCP server
orchestration/    pipeline, queue, decomposer, runner seam (read-only in the sandbox)
proxy/            the logging proxy
queue/            the work queue (writable: this is where jobs move)
tests/            everything above, proven green
```
