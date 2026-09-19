/**
 * The seam between deterministic plumbing and the model.
 *
 * Everything above this interface is ordinary, unit-testable TypeScript; the
 * only thing that ever talks to Claude is the ClaudeRunner below. Tests
 * inject a fake AgentRunner instead - orchestration logic is verified without
 * spending a token.
 */
import { execFile } from "node:child_process";

export interface AgentRunResult {
  ok: boolean;
  output: string;
}

export interface AgentRunner {
  run(agent: string, prompt: string): Promise<AgentRunResult>;
}

/**
 * Runs `claude -p --agent <name>` non-interactively. The agent's definition
 * (tools, model, instructions) lives in .claude/agents/<name>.md - the agent
 * body replaces the harness system prompt on the wire.
 */
export class ClaudeRunner implements AgentRunner {
  constructor(private readonly cwd: string) {}

  run(agent: string, prompt: string): Promise<AgentRunResult> {
    return new Promise((resolve) => {
      const child = execFile(
        "claude",
        ["-p", "--agent", agent, "--output-format", "json"],
        { cwd: this.cwd, maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60 * 1000 },
        (error, stdout, stderr) => {
          if (error) {
            resolve({ ok: false, output: `${stdout}\n${stderr}`.trim() });
            return;
          }
          try {
            const parsed = JSON.parse(stdout) as { result?: string; is_error?: boolean };
            resolve({ ok: parsed.is_error !== true, output: parsed.result ?? stdout });
          } catch {
            resolve({ ok: true, output: stdout });
          }
        },
      );
      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }
}
