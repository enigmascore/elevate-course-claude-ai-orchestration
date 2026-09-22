/**
 * The seam between deterministic plumbing and the model - and the ONE place
 * this repository talks to Claude.
 *
 * Everything above the AgentRunner interface is ordinary, unit-testable
 * TypeScript; tests inject a fake runner and never spend a token. Below it,
 * ClaudeRunner drives the Claude Agent SDK: it reads an agent's definition
 * from .claude/agents/<name>.md and hands it to `query()`, which is the SDK's
 * counterpart of `claude -p --agent <name>`.
 *
 * Three levers of least privilege live here, and the course teaches all three:
 *   1. WHICH tools an agent has        - the agent file's `tools:` line
 *   2. WHAT each tool may do            - the agent file's `permissions:` block,
 *                                          turned into the SDK's permission callback
 *   3. WHERE the agent runs             - only inside the docker sandbox
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { query, type CanUseTool, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";

// ---------------------------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------------------------

export interface AgentRunResult {
  ok: boolean;
  output: string;
  /** Per-model token usage for the run, when the runner can report it. Fakes in tests return none. */
  usage?: ModelUsage;
  /** The parsed object when the run asked for structured output ( a JSON schema ). */
  structured?: unknown;
}

export interface RunOptions {
  /** Hard cap on agentic turns; the run fails cleanly when it is reached. */
  maxTurns?: number;
  /** Hard cap on wall-clock time; the run is aborted and fails cleanly when it is reached. */
  timeoutMs?: number;
  /** Ask the model for its answer AS this JSON schema; the result arrives in `structured`. */
  outputSchema?: Record<string, unknown>;
}

export interface AgentRunner {
  run(agent: string, prompt: string, options?: RunOptions): Promise<AgentRunResult>;
}

/** Keyed by model ID ( e.g. "claude-sonnet-5" ). */
export type ModelUsage = Record<
  string,
  { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }
>;

export function parseModelUsage(raw: unknown): ModelUsage | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const usage: ModelUsage = {};
  for (const [model, v] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
    const n = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : 0);
    usage[model] = {
      inputTokens: n("inputTokens"),
      outputTokens: n("outputTokens"),
      cacheReadInputTokens: n("cacheReadInputTokens"),
      cacheCreationInputTokens: n("cacheCreationInputTokens"),
    };
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
}

// ---------------------------------------------------------------------------------------------
// Lever 1 and 2: the agent file
// ---------------------------------------------------------------------------------------------

/** What .claude/agents/<name>.md declares. The same file serves `claude -p --agent` and the SDK. */
export interface AgentDefinition {
  name: string;
  description: string;
  tools: string[];
  model: string;
  /** The agent's instructions - the markdown body below the frontmatter. */
  prompt: string;
  /** Lever 2: what the allowed tools may do. Absent = nothing that needs permission is allowed. */
  permissions: { write: string[]; bash: string[] };
}

/**
 * Parse the agent file. Frontmatter lines starting with `#` are comments (the
 * course puts each agent's tier and reason there); `permissions:` is a small
 * indented block whose values are flow lists `[a, b]` or comma-separated.
 * `name:` is REQUIRED and must equal the file's basename - Claude Code's own
 * loader needs it, and a mismatch would make the two readers disagree.
 */
export function parseAgentFile(source: string, expectedName: string): AgentDefinition {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error(`agent file for "${expectedName}" has no frontmatter block`);
  const frontmatter = m[1]!;
  const prompt = m[2]!.trim();

  const top: Record<string, string> = {};
  const permissions = { write: [] as string[], bash: [] as string[] };
  let inPermissions = false;
  for (const raw of frontmatter.split(/\r?\n/)) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    if (inPermissions && /^\s+\S/.test(raw)) {
      const [k, ...rest] = raw.trim().split(":");
      const key = (k ?? "").trim();
      if (key === "write" || key === "bash") permissions[key] = parseList(rest.join(":"));
      continue;
    }
    inPermissions = false;
    const i = raw.indexOf(":");
    if (i < 0) continue;
    const key = raw.slice(0, i).trim();
    const value = raw.slice(i + 1).trim();
    if (key === "permissions") {
      inPermissions = true;
      continue;
    }
    top[key] = value;
  }

  const name = top["name"];
  if (!name) throw new Error(`agent file for "${expectedName}" is missing the required "name:" field`);
  if (name !== expectedName)
    throw new Error(`agent file "${expectedName}.md" declares name "${name}" - the name must equal the filename`);
  if (!top["description"]) throw new Error(`agent "${name}" is missing "description:"`);
  if (!prompt) throw new Error(`agent "${name}" has no instructions below its frontmatter`);

  return {
    name,
    description: top["description"],
    tools: parseList(top["tools"] ?? ""),
    model: top["model"] ?? "inherit",
    prompt,
    permissions,
  };
}

function parseList(value: string): string[] {
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length > 0);
}

export function loadAgentDefinition(root: string, name: string): AgentDefinition {
  const file = path.join(root, ".claude", "agents", `${name}.md`);
  if (!fs.existsSync(file)) throw new Error(`no agent named "${name}": expected ${file}`);
  return parseAgentFile(fs.readFileSync(file, "utf8"), name);
}

// ---------------------------------------------------------------------------------------------
// Lever 2: the policy - "exactly what a human would have approved"
// ---------------------------------------------------------------------------------------------

export type PolicyDecision = { allow: true } | { allow: false; reason: string };

/**
 * Decide one tool call against the agent's permissions block. Pure, so it is
 * tested without the SDK. The harness consults this for the calls it would
 * have prompted a human for; read-only calls it already trusts never reach it.
 */
export function decide(def: AgentDefinition, toolName: string, input: Record<string, unknown>, cwd: string): PolicyDecision {
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit" || toolName === "NotebookEdit") {
    const filePath = typeof input["file_path"] === "string" ? input["file_path"] : typeof input["notebook_path"] === "string" ? input["notebook_path"] : "";
    const rel = relativeTo(cwd, filePath);
    if (rel === null) return { allow: false, reason: `${toolName} outside the repository: ${filePath}` };
    if (def.permissions.write.some((prefix) => rel.startsWith(prefix))) return { allow: true };
    return { allow: false, reason: `${toolName} to "${rel}" is not permitted for agent ${def.name} ( allowed: ${list(def.permissions.write)} )` };
  }
  if (toolName === "Bash") {
    const command = typeof input["command"] === "string" ? input["command"].trim() : "";
    if (def.permissions.bash.some((prefix) => command.startsWith(prefix))) return { allow: true };
    return { allow: false, reason: `command "${command}" is not permitted for agent ${def.name} ( allowed prefixes: ${list(def.permissions.bash)} )` };
  }
  // Anything else that asks ( a web fetch, an MCP tool, ... ) is not in this agent's remit.
  return { allow: false, reason: `${toolName} is not permitted for agent ${def.name}` };
}

function relativeTo(cwd: string, filePath: string): string | null {
  if (!filePath) return null;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const rel = path.relative(cwd, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel;
}

function list(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "nothing";
}

// ---------------------------------------------------------------------------------------------
// Lever 3: where the agent runs
// ---------------------------------------------------------------------------------------------

export const SANDBOX_ENV = "ORCHESTRATION_SANDBOX";
export const SANDBOX_REFUSAL = "run this inside the sandbox: make sandbox";

export function insideSandbox(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SANDBOX_ENV] === "1";
}

// ---------------------------------------------------------------------------------------------
// The run log - one line per agent run, the audit trail at the agent level
// ---------------------------------------------------------------------------------------------

export interface RunRecord {
  at: string;
  agent: string;
  models: string[];
  turns: number;
  durationMs: number;
  outcome: "ok" | "error" | "max-turns" | "timeout";
  usage?: ModelUsage;
  /** True when the answer arrived as structured output ( a schema was asked for and honoured ). */
  structured: boolean;
  /** SHA-256 of the prompt - never the prompt itself, a job body may be private. */
  promptSha256: string;
  denials: string[];
}

export function runLogFile(root: string): string {
  return path.join(root, "queue", "runs.jsonl");
}

export function appendRunLog(root: string, record: RunRecord): void {
  const file = runLogFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------------------------
// The SDK runner
// ---------------------------------------------------------------------------------------------

export const DEFAULT_MAX_TURNS = 40;
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Structured output is DELIVERED by a tool call: the harness gives the model a
 * `StructuredOutput` tool and the answer arrives as its input. An agent whose
 * `tools:` list omits it silently falls back to plain text - so when a run
 * asks for a schema, the runner adds the tool to that run's tools.
 */
export const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

export function toolsFor(def: AgentDefinition, wantsSchema: boolean): string[] {
  return wantsSchema && !def.tools.includes(STRUCTURED_OUTPUT_TOOL) ? [...def.tools, STRUCTURED_OUTPUT_TOOL] : def.tools;
}

/** What `query()` hands back on its final message - the fields this runner reads. */
export interface ResultLike {
  subtype: string;
  is_error?: boolean;
  result?: string;
  num_turns?: number;
  modelUsage?: unknown;
  structured_output?: unknown;
}

/** Map the SDK's result message to the seam's result. Pure, tested without the SDK. */
export function mapResult(r: ResultLike, caps: { maxTurns: number }): AgentRunResult & { outcome: RunRecord["outcome"] } {
  const usage = parseModelUsage(r.modelUsage);
  if (r.subtype === "error_max_turns")
    return { ok: false, output: `stopped: reached the cap of ${caps.maxTurns} turns`, usage, outcome: "max-turns" };
  if (r.subtype !== "success" || r.is_error === true)
    return { ok: false, output: r.result ?? r.subtype, usage, outcome: "error" };
  return { ok: true, output: r.result ?? "", usage, structured: r.structured_output, outcome: "ok" };
}

export class ClaudeRunner implements AgentRunner {
  constructor(
    private readonly cwd: string,
    private readonly log: (line: string) => void = (line) => console.error(line),
  ) {}

  async run(agent: string, prompt: string, options: RunOptions = {}): Promise<AgentRunResult> {
    if (!insideSandbox()) throw new Error(SANDBOX_REFUSAL);
    const def = loadAgentDefinition(this.cwd, agent);
    const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const denials: string[] = [];
    const started = Date.now();

    const canUseTool: CanUseTool = async (toolName, input): Promise<PermissionResult> => {
      const decision = decide(def, toolName, input, this.cwd);
      if (decision.allow) return { behavior: "allow" };
      denials.push(decision.reason);
      this.log(`[policy] ${agent}: denied ${decision.reason}`);
      return { behavior: "deny", message: `policy: ${decision.reason}` };
    };

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);
    let final: ResultLike | undefined;
    let timedOut = false;
    try {
      for await (const message of query({
        prompt,
        options: {
          cwd: this.cwd,
          agents: {
            [def.name]: {
              description: def.description,
              prompt: def.prompt,
              tools: toolsFor(def, options.outputSchema !== undefined),
              model: def.model,
            },
          },
          agent: def.name,
          canUseTool,
          maxTurns,
          abortController,
          env: { ...process.env },
          ...(options.outputSchema ? { outputFormat: { type: "json_schema" as const, schema: options.outputSchema } } : {}),
        },
      })) {
        if (message.type === "result") final = message as unknown as ResultLike;
      }
    } catch (err) {
      if (abortController.signal.aborted) timedOut = true;
      else if (!final) final = { subtype: "error", is_error: true, result: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }

    const mapped = timedOut
      ? { ok: false, output: `stopped: exceeded the cap of ${timeoutMs / 1000}s`, outcome: "timeout" as const, usage: parseModelUsage(final?.modelUsage) }
      : mapResult(final ?? { subtype: "error", is_error: true, result: "no result message" }, { maxTurns });

    appendRunLog(this.cwd, {
      at: new Date(started).toISOString(),
      agent: def.name,
      models: Object.keys(mapped.usage ?? {}),
      turns: final?.num_turns ?? 0,
      durationMs: Date.now() - started,
      outcome: mapped.outcome,
      usage: mapped.usage,
      structured: mapped.structured !== undefined,
      promptSha256: sha256(prompt),
      denials,
    });
    const { outcome: _outcome, ...result } = mapped;
    return result;
  }
}
