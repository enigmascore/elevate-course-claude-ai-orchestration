# Claude AI Orchestration — course template

The practice environment for the **Claude AI Orchestration** course, and the
starting point of its one marked assignment. It is a **partly written system**:
everything you study during the course works and is tested green; the two
things the assignment asks for are present only as empty slots, with their
tests already written and **red**.

Everything that runs an agent runs **inside the docker sandbox**. That is not a
suggestion: the runner refuses to start an agent anywhere else.

| Piece | Where | State at a fresh clone |
|---|---|---|
| Docker sandbox | `docker/` | Works — the only place agents run |
| Logging proxy | `proxy/logproxy.ts` | Works, tested green |
| Example MCP server `course-tools` | `mcp/example-server.ts` | Works, tested green — two tools |
| The SDK runner | `orchestration/runner.ts` | Works, tested green — the ONE place this repo talks to Claude |
| File-based pipeline | `orchestration/` | Works, tested green — decomposer → queue → atomic claim → implementer |
| Agent definitions | `.claude/agents/` | `decomposer` (top tier) and `implementer` (everyday tier), each with its permissions |
| **Your MCP server** `my-tools` | `mcp/my-server.ts` | **Slot**: starts, exposes no tools — `tests/gate/mcp-my-server.spec.ts` is red |
| **The version toolkit** | `target/version-toolkit.ts` | **Stubs**: typed signatures that throw — `tests/gate/version-toolkit/*.spec.ts` are red |
| The toolkit's requirements | `requirements/version_toolkit_requirements.md` | The resolved requirements file your pipeline will consume |

```bash
make                 # lists every target with its description
make verify          # tsc + every test: red at a clone, green when the assignment is done
make test-shipped    # only what ships: green from the first clone
make test-gate       # only the two assignment suites: red until you are done
```

Every command below is a `make` target (wrapping the pnpm scripts in
`package.json`); `make` on its own prints the list.

## Getting started

1. **Create your own repository from this template.** On this repository's
   GitHub page click **Use this template → Create a new repository**. Name it
   `firstname-lastname-claude-ai-orchestration` (your own name), make it
   **private**, and invite the markers the course names.

2. **Clone it and install on the host** (Node 24+, pnpm 10, Docker Desktop):

```bash
git clone https://github.com/YOUR_USER/firstname-lastname-claude-ai-orchestration.git
cd firstname-lastname-claude-ai-orchestration
make install
make test-shipped    # everything shipped is green
make test-gate       # the two assignment suites are red - that is the starting line
```

3. **Enter the sandbox and log in once.** Inside it, run `claude`. It walks
   you through, in this order: a colour theme; the login method (choose
   *Claude account with subscription*); a sign-in URL — open it in your
   browser, then paste the code it gives you back into the terminal; the
   security notes (Enter); **Yes, I trust this folder**; and the MCP servers it
   found — make sure BOTH `course-tools` and `my-tools` are ticked and choose
   *Enable selected* (a student who enables only one later finds their own
   server missing). Type `/exit`. Then `gh auth login`: GitHub.com, HTTPS,
   authenticate Git with your GitHub credentials, log in with a web browser —
   inside the container it cannot copy the one-time code for you, so open
   `https://github.com/login/device` yourself and type the code it shows. Then
   `exit`. All of it persists in named docker volumes, so this happens once.

```bash
make sandbox         # builds the image the first time, then opens a shell inside
claude               # theme, subscription login via URL + code, trust folder, enable BOTH servers, /exit
gh auth login        # GitHub.com, HTTPS, authenticate git: Y, web browser -> github.com/login/device
exit
```

Until those prompts are answered, the interactive `claude` does not load the
project's agents or MCP servers (`/mcp` shows nothing). The pipeline does not
need them: the SDK runner reads the agent files itself.

## The sandbox

`docker/run.sh` (behind `make sandbox`) maps this repository into the
container **read-write, except the control plane**: `orchestration/`,
`.claude/`, `.mcp.json` and `docker/` are re-mounted **read-only**. Agents can
edit the work tree (`target/`, `mcp/`) and the queue, but never rewrite the
orchestration itself, the agent definitions, or this docker setup. The docker
wall protects your machine; the read-only mounts protect the system from its
own agents; and the image sets `ORCHESTRATION_SANDBOX=1`, the marker the
runner checks before it will run any agent — on the host it prints
`run this inside the sandbox: make sandbox` and stops.

The container has its **own `node_modules`** (a named volume), installed on
first start from the lockfile, so host and container installs never collide.
Your git identity is passed in from the host's `git config`, and if `gh` is
logged in, `git push` uses that login.

Two ways to use it: `make sandbox` for a shell, or the detached targets
below, which run one long-lived process in a named container you can watch
with `make sandbox-logs` and stop with `make sandbox-stop`.

## The logging proxy

Inside the sandbox, in one shell:

```bash
make proxy
```

In another, point claude at it for one command:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8765 claude -p "Reply with exactly OK."
```

Each exchange lands in `captures/` as one JSON file holding the full request
and response. The same variable, set on the pipeline's process, captures the
SDK's traffic too — the runner passes its environment through.

## The two MCP servers

`.mcp.json` wires TWO servers into claude. `course-tools` (`mcp/example-server.ts`)
is the working example: `roll_dice` (a required typed input) and
`count_letters`. `my-tools` (`mcp/my-server.ts`) is YOURS: it ships as a valid
server with no tools. The assignment asks you to give it at least one tool of
your own design — different from both example tools in name AND input shape,
with a required typed input — until `tests/gate/mcp-my-server.spec.ts` is
green. That suite spawns your server exactly as `.mcp.json` does and speaks
the protocol to it; no model is involved.

## The runner: where this repository talks to Claude

`orchestration/runner.ts` is the one seam. Above it, everything is ordinary
TypeScript with a fake runner in the tests. Below it, `ClaudeRunner` drives
the **Claude Agent SDK** — `query()` is the SDK's counterpart of
`claude -p --agent <name>`:

| You typed, in the interactive half | The runner does, in code |
|---|---|
| `claude -p --agent implementer "..."` | `query({ prompt, options: { agent, agents } })` with the agent read from `.claude/agents/implementer.md` |
| `--output-format json` | iterate the messages to the `result` message; `outputFormat: { type: "json_schema" }` gets the answer AS your schema (delivered by a `StructuredOutput` tool call — the runner adds that tool to the run) |
| `--dangerously-skip-permissions` | **not used** — a permission callback built from the agent's `permissions:` block says exactly what a human would have approved |
| `ANTHROPIC_BASE_URL=... claude -p` | the `env` option, so the proxy sees SDK traffic |

Three levers of least privilege, all in the agent file:

```yaml
name: implementer            # required - the same file serves claude -p and the SDK
tools: Read, Write, Edit, Glob, Grep, Bash   # WHICH tools exist for this agent
model: sonnet
permissions:
  write: [target/, mcp/]     # WHAT Write/Edit may touch
  bash: [pnpm ]              # WHAT Bash may run - prefixes
```

...and the third lever is WHERE: the sandbox. Every run is capped (`maxTurns`
40, 10 minutes; the decomposer 8 turns) and logged to `queue/runs.jsonl` —
agent, model, turns, duration, outcome, tokens, a hash of the prompt, and
every refused call.

## The pipeline

Inside the sandbox, watcher FIRST, then drop the work:

```bash
make sandbox-pipeline     # terminal 1, detached: the watcher ( make sandbox-logs to watch )
make sandbox-decompose    # terminal 2, once: split requirements/version_toolkit_requirements.md into jobs
```

Or from a `make sandbox` shell: `make pipeline` in one, `make decompose` in
another. The decomposer agent splits the requirements into small files (its
answer arrives as structured output matching a schema, validated again in
code); the plumbing drops each into `queue/small/dropped/` via an atomic
rename; the watcher claims each job by atomically moving it to
`queue/small/processing/` and stamps the claim; the implementer agent runs on
it; finished jobs land in `done/`, exhausted retries in `failed/`; a claim
older than the run's cap is a dead worker's and comes back as another
attempt. Every reliability property rests on one primitive — a rename within
one filesystem is atomic — and the tests in `tests/` prove the mechanics
without a single model call.

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
| your `target-implementer` | everyday model — the assignment names it | sonnet |

Each agent file's frontmatter carries its tier and the reason; your
`target-implementer` must too, in your own words. A student on a bigger plan
may substitute their top tier; the tier, not the name, is the rule.

## The marked assignment, in one paragraph

Starting from your private copy of this template, inside the sandbox:
(1) build your MCP server in the `my-tools` slot until its gate suite is green;
(2) build the GitHub variant of the pipeline — the decomposer raises each small
requirement as an issue labelled `target-module`, a poller dispatches agents by
label, the pipeline runs each job's tests and re-queues on red, and the poller
never starts a new job while one of its pull requests awaits your review;
(3) author `.claude/agents/target-implementer.md` on the everyday tier the
assignment names, with a tier comment saying why and a `permissions:` block
confined to `target/` and the two test commands, and route the `target-module`
label to it; (4) run your pipeline over
`requirements/version_toolkit_requirements.md` until every
`tests/gate/version-toolkit/*.spec.ts` is green — the AGENTS write
`target/version-toolkit.ts`, not you. Your variant calls agents ONLY through
`orchestration/runner.ts`; never shell out to `claude -p`. Never edit the
tests or the contract's signatures.

Wire your variant into the two `make` targets shipped as placeholders,
`make poll` and `make decompose-github`, and run it the way you ran the file
pipeline: **`make sandbox-poll` first** (it keeps running, one pass a minute,
and waits whenever one of its pull requests is open), then
`make sandbox-decompose-github` once. Review and merge each pull request as it
appears; when the queue is empty and every gate test is green,
`make sandbox-stop`.

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
make install
make verify                                       # tsc + all suites green, gate suites included
git diff origin/main...HEAD --diff-filter=MD -- tests/   # must print nothing: shipped tests unmodified ( adding tests is fine )
grep -rn "execFile\|spawn" orchestration/ | grep claude   # must print nothing: agents only via the runner
ls mcp/my-server.ts .claude/agents/target-implementer.md
make sandbox                                      # builds and enters
```

Then a **process review**: the merged agent PRs on your question branch (their
timestamps, issue numbers and the `target-module` label), the issue trail, the
agent definition with its tier comment and permissions block, and
`queue/runs.jsonl` — evidence that the ORCHESTRATION did the work.
Hand-writing `target/version-toolkit.ts` and claiming the pipeline did it is
the known shortcut, and the trail is what catches it. Traceability of agent
work is itself a lesson.

## What this template shows you

The practices the course teaches, and where each one lives here:

| Practice | Where |
|---|---|
| Deterministic plumbing, judgment in agents | `orchestration/queue.ts`, the runner seam |
| Atomic claim — no double work | `claim()` in `queue.ts` |
| Context passing — the job carries everything | `.claude/agents/decomposer.md` rules |
| Retries, and stale-claim recovery | `pipeline.ts` `processJob` and `sweep` |
| Cost caps | `maxTurns` and the timeout in `runner.ts` |
| Least privilege — tools, permissions, sandbox | the agent files' `tools:` and `permissions:`, `runner.ts`, `docker/` |
| Model per role | the agent files' `model:` and tier comments |
| Structured output, validated twice | `decompose.ts` `DECOMPOSITION_SCHEMA`, `validatePieces` |
| Observability — a trace of every run | `queue/runs.jsonl` |
| Reproducibility — pinned versions | `package.json`, `docker/Dockerfile` |
| Testing the plumbing without the model | `tests/` with the fake runner |
| The human gate — PRs, never main | the assignment's git shape |
| No secrets in the repo | logins live in docker volumes; no API key anywhere |

## Layout

```
Makefile          every command, with `make` listing them
.claude/agents/   agent definitions (control plane, read-only in the sandbox)
docker/           sandbox image, entry script, run script (read-only in the sandbox)
mcp/              example-server.ts (works) and my-server.ts (your slot)
orchestration/    runner (the SDK seam), pipeline, queue, decomposer (read-only in the sandbox)
proxy/            the logging proxy
queue/            the work queue and runs.jsonl (writable: this is where jobs move)
requirements/     the resolved requirements file your pipeline consumes
target/           the version toolkit contract (stubs your agents fill)
tests/            shipped suites (green) and tests/gate/ (red until you are done)
```
