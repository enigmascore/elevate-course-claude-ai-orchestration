/**
 * The SDK runner's deterministic parts, proven without the SDK: the agent-file
 * parser, the least-privilege policy, the result mapping, the sandbox guard.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ClaudeRunner,
  SANDBOX_ENV,
  SANDBOX_REFUSAL,
  decide,
  loadAgentDefinition,
  mapResult,
  parseAgentFile,
  toolsFor,
  STRUCTURED_OUTPUT_TOOL,
  type AgentDefinition,
} from "../orchestration/runner.js";

const root = path.resolve(import.meta.dirname, "..");

describe("parseAgentFile", () => {
  const source = [
    "---",
    "# tier: a comment line - ignored",
    "",
    "name: worker",
    "description: does work",
    "tools: Read, Write, Bash",
    "model: sonnet",
    "permissions:",
    "  write: [target/, mcp/]",
    "  bash: [pnpm vitest run tests/gate/, pnpm tsc:check]",
    "---",
    "",
    "You are the WORKER.",
    "Do the work.",
  ].join("\n");

  it("reads name, description, tools, model, permissions and the body, skipping comments", () => {
    const def = parseAgentFile(source, "worker");
    expect(def).toEqual({
      name: "worker",
      description: "does work",
      tools: ["Read", "Write", "Bash"],
      model: "sonnet",
      prompt: "You are the WORKER.\nDo the work.",
      permissions: { write: ["target/", "mcp/"], bash: ["pnpm vitest run tests/gate/", "pnpm tsc:check"] },
    });
  });

  it("requires name: and requires it to equal the filename", () => {
    expect(() => parseAgentFile(source.replace("name: worker\n", ""), "worker")).toThrow(/missing the required "name:"/);
    expect(() => parseAgentFile(source, "other")).toThrow(/must equal the filename/);
  });

  it("defaults permissions to nothing and model to inherit", () => {
    const def = parseAgentFile("---\nname: ro\ndescription: read only\ntools: Read\n---\nRead things.", "ro");
    expect(def.permissions).toEqual({ write: [], bash: [] });
    expect(def.model).toBe("inherit");
  });

  it("loads every shipped agent file, each named after its file", () => {
    for (const file of fs.readdirSync(path.join(root, ".claude", "agents"))) {
      const name = file.replace(/\.md$/, "");
      expect(loadAgentDefinition(root, name).name).toBe(name);
    }
    expect(() => loadAgentDefinition(root, "no-such-agent")).toThrow(/no agent named "no-such-agent"/);
  });
});

describe("decide (the permission policy)", () => {
  const def: AgentDefinition = {
    name: "worker",
    description: "",
    tools: ["Read", "Write", "Edit", "Bash"],
    model: "sonnet",
    prompt: "",
    permissions: { write: ["target/"], bash: ["pnpm vitest run tests/gate/", "pnpm tsc:check"] },
  };
  const cwd = "/repo";

  it("allows writes under a permitted prefix, relative or absolute", () => {
    expect(decide(def, "Write", { file_path: "target/version-toolkit.ts" }, cwd)).toEqual({ allow: true });
    expect(decide(def, "Edit", { file_path: "/repo/target/x.ts" }, cwd)).toEqual({ allow: true });
  });

  it("denies writes elsewhere - tests, the control plane, outside the repo - naming the reason", () => {
    expect(decide(def, "Write", { file_path: "tests/gate/x.spec.ts" }, cwd)).toMatchObject({ allow: false, reason: expect.stringContaining('"tests/gate/x.spec.ts"') });
    expect(decide(def, "Edit", { file_path: "orchestration/runner.ts" }, cwd).allow).toBe(false);
    expect(decide(def, "Write", { file_path: "/etc/passwd" }, cwd).allow).toBe(false);
    expect(decide(def, "Write", { file_path: "../elsewhere/x" }, cwd).allow).toBe(false);
  });

  it("allows only the permitted command prefixes", () => {
    expect(decide(def, "Bash", { command: "pnpm vitest run tests/gate/version-toolkit/parse-version.spec.ts" }, cwd)).toEqual({ allow: true });
    expect(decide(def, "Bash", { command: "pnpm tsc:check" }, cwd)).toEqual({ allow: true });
    expect(decide(def, "Bash", { command: "curl https://example.com" }, cwd).allow).toBe(false);
    expect(decide(def, "Bash", { command: "rm -rf target" }, cwd).allow).toBe(false);
  });

  it("denies any other tool that asks", () => {
    expect(decide(def, "WebFetch", { url: "https://x" }, cwd).allow).toBe(false);
  });
});

describe("toolsFor", () => {
  const def = { name: "d", description: "", tools: ["Read"], model: "opus", prompt: "", permissions: { write: [], bash: [] } };
  it("adds the StructuredOutput tool only when a schema is requested", () => {
    expect(toolsFor(def, true)).toEqual(["Read", STRUCTURED_OUTPUT_TOOL]);
    expect(toolsFor(def, false)).toEqual(["Read"]);
    expect(toolsFor({ ...def, tools: ["Read", STRUCTURED_OUTPUT_TOOL] }, true)).toEqual(["Read", STRUCTURED_OUTPUT_TOOL]);
  });
});

describe("mapResult", () => {
  it("maps success, structured output and usage", () => {
    const r = mapResult({ subtype: "success", result: "done", structured_output: { pieces: [] }, modelUsage: { m: { inputTokens: 1 } } }, { maxTurns: 40 });
    expect(r).toMatchObject({ ok: true, output: "done", structured: { pieces: [] }, outcome: "ok" });
    expect(r.usage?.["m"]?.inputTokens).toBe(1);
  });
  it("names the turn cap when it is hit, and reports other errors", () => {
    expect(mapResult({ subtype: "error_max_turns" }, { maxTurns: 8 })).toMatchObject({ ok: false, output: "stopped: reached the cap of 8 turns", outcome: "max-turns" });
    expect(mapResult({ subtype: "success", is_error: true, result: "API Error" }, { maxTurns: 8 })).toMatchObject({ ok: false, output: "API Error", outcome: "error" });
  });
});

describe("ClaudeRunner outside the sandbox", () => {
  it("refuses to run any agent, before touching the SDK", async () => {
    const saved = process.env[SANDBOX_ENV];
    delete process.env[SANDBOX_ENV];
    try {
      await expect(new ClaudeRunner(root, () => {}).run("implementer", "x")).rejects.toThrow(SANDBOX_REFUSAL);
    } finally {
      if (saved !== undefined) process.env[SANDBOX_ENV] = saved;
    }
  });
});
