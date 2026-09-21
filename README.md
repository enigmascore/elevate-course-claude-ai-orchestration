# Claude AI Orchestration — course template

The practice environment for the **Claude AI Orchestration** course, and the
starting point of its one marked assignment. It is a **partly written system**:
everything you study during the course works and is tested green; the two
things the assignment asks for are present only as empty slots, with their
tests already written and **red**.

| Piece | Where | State at a fresh clone |
|---|---|---|
| Docker sandbox | `docker/` | Works — auto mode on, blast radius contained |
| Logging proxy | `proxy/logproxy.ts` | Works, tested green |
| Example MCP server `course-tools` | `mcp/example-server.ts` | Works, tested green — two tools |
| File-based pipeline | `orchestration/` | Works, tested green — decomposer → queue → atomic claim → implementer |
| Agent definitions | `.claude/agents/` | `decomposer` (top tier) and `implementer` (everyday tier) |
| **Your MCP server** `my-tools` | `mcp/my-server.ts` | **Slot**: starts, exposes no tools — `tests/gate/mcp-my-server.spec.ts` is red |
| **The version toolkit** | `target/version-toolkit.ts` | **Stubs**: typed signatures that throw — `tests/gate/version-toolkit/*.spec.ts` are red |
| The toolkit's requirements | `requirements/version_toolkit_requirements.md` | The resolved requirements file your pipeline will consume |

```bash
pnpm verify          # tsc + every test: red at a clone, green when the assignment is done
pnpm test:shipped    # only what ships: green from the first clone
pnpm test:gate       # only the two assignment suites: red until you are done
```

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
pnpm test:shipped    # everything shipped is green
pnpm test:gate       # the two assignment suites are red - that is the starting line
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
the work tree (including `target/` and `mcp/`) and the queue, but can never
rewrite the orchestration itself, the agent definitions, or this docker setup.
The docker wall protects your machine; the read-only mounts protect the
system from its own agents. YOU edit the control plane on the host — that is
where the assignment's orchestration work happens.

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

## The two MCP servers

`.mcp.json` wires TWO servers into claude. `course-tools` (`mcp/example-server.ts`)
is the working example: `roll_dice` (a required typed input) and
`count_letters`; a fresh clone shows it under `/mcp` in a claude session.
`my-tools` (`mcp/my-server.ts`) is YOURS: it ships as a valid server with no
tools. The assignment asks you to give it at least one tool of your own design
— different from both example tools in name AND input shape, with a required
typed input — until `tests/gate/mcp-my-server.spec.ts` is green. That suite
spawns your server exactly as `.mcp.json` does and speaks the protocol to it;
no model is involved.

## The pipeline

```bash
pnpm pipeline                                          # terminal 1: watch the queue
pnpm decompose requirements/version_toolkit_requirements.md   # terminal 2: split into jobs
```

The decomposer agent splits the requirements into small files; the plumbing
drops each into `queue/small/dropped/` via an atomic rename; the watcher
claims each job by atomically moving it to `queue/small/processing/` and runs
the implementer agent on it; finished jobs land in `done/`, exhausted retries
in `failed/`. Every reliability property rests on one primitive — a rename
within one filesystem is atomic — and the tests in `tests/` prove the
mechanics without a single model call.

**What the shipped pipeline deliberately does NOT do**: it treats the
implementer agent *saying* it succeeded as success — look at `processJob` in
`orchestration/pipeline.ts`; nothing runs the job's tests. Building that
**test gate** (run the job's tests, re-queue on red, fail after `maxAttempts`)
is part of the assignment, as is the GitHub variant of the whole pipeline.

## Which model for which agent

| Role | Tier | As of authoring |
|---|---|---|
| `decomposer` | top tier — the one judgment-heavy step; runs once per requirements file | opus |
| `implementer` | everyday model — runs many times, gated by tests | sonnet |
| labelling / titling / routing chores | small fast model | haiku |
| test running, queue mechanics | no model — deterministic code | — |
| your `target-implementer` | your choice — JUSTIFY it in the PR | — |

Each agent file's frontmatter carries its tier and the reason. A student on a
bigger plan may substitute their top tier; the tier, not the name, is the
rule. Dropping the implementer to the small fast model is a deliberate course
experiment: watch verification substitute for capability.

## The marked assignment, in one paragraph

Starting from your private copy of this template: (1) build your MCP server
in the `my-tools` slot until its gate suite is green; (2) build the GitHub
variant of the pipeline — the decomposer raises each small requirement as an
issue labelled `target-module`, a poller dispatches agents by label, and the
pipeline runs each job's tests and re-queues on red; (3) author
`.claude/agents/target-implementer.md`, route the `target-module` label to it,
and choose (and justify) its model; (4) run your pipeline over
`requirements/version_toolkit_requirements.md` until every
`tests/gate/version-toolkit/*.spec.ts` is green — the AGENTS write
`target/version-toolkit.ts`, not you. Never edit the tests or the contract's
signatures.

Git shape: your question branch (created from your issue) is the base. Each
agent works on its own `agent/<issue-number>` branch and raises a pull request
**into your question branch**; **you** review and merge each one. When both
gate suites are green, open the single PR from your question branch into
`main` and paste its URL into the course.

```
main
 └── question branch            ( you, from your issue )
      ├── agent/12  -- PR -->  question branch   ( parseVersion )
      ├── agent/13  -- PR -->  question branch   ( formatVersion )
      ├── agent/14  -- PR -->  question branch   ( compareVersions )
      └── ...
question branch -- the ONE PR --> main           ( URL pasted )
```

## How it is marked

The marker clones your question branch and runs, in this order:

```bash
pnpm install
pnpm verify                                       # tsc + all suites green, gate suites included
git diff origin/main...HEAD -- tests/             # must print nothing: tests untouched
ls mcp/my-server.ts .claude/agents/target-implementer.md
./docker/run.sh                                   # builds and enters
```

Then a **process review**: the merged agent PRs on your question branch (their
timestamps, issue numbers and the `target-module` label), the issue trail, the
agent definition with its model justification — evidence that the
ORCHESTRATION did the work. Hand-writing `target/version-toolkit.ts` and
claiming the pipeline did it is the known shortcut, and the trail is what
catches it. Traceability of agent work is itself a lesson.

## Layout

```
.claude/agents/   agent definitions (control plane, read-only in the sandbox)
docker/           sandbox image + run script (read-only in the sandbox)
mcp/              example-server.ts (works) and my-server.ts (your slot)
orchestration/    pipeline, queue, decomposer, runner seam (read-only in the sandbox)
proxy/            the logging proxy
queue/            the work queue (writable: this is where jobs move)
requirements/     the resolved requirements file your pipeline consumes
target/           the version toolkit contract (stubs your agents fill)
tests/            shipped suites (green) and tests/gate/ (red until you are done)
```
