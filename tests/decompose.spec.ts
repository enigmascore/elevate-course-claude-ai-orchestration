import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decompose, parseDecomposition } from "../orchestration/decompose.js";
import { listDropped, queuePaths } from "../orchestration/queue.js";
import type { AgentRunner, AgentRunResult } from "../orchestration/runner.js";

class OneShotRunner implements AgentRunner {
  calls: Array<{ agent: string; prompt: string }> = [];
  constructor(private readonly result: AgentRunResult) {}
  async run(agent: string, prompt: string): Promise<AgentRunResult> {
    this.calls.push({ agent, prompt });
    return this.result;
  }
}

describe("parseDecomposition", () => {
  it("accepts a plain JSON array", () => {
    const items = parseDecomposition('[{"name":"a-b.md","content":"do a and b"}]');
    expect(items).toEqual([{ name: "a-b.md", content: "do a and b" }]);
  });

  it("tolerates a fenced code block around the array", () => {
    const items = parseDecomposition('```json\n[{"name":"x.md","content":"x"}]\n```');
    expect(items).toEqual([{ name: "x.md", content: "x" }]);
  });

  it("rejects a bad filename and empty content", () => {
    expect(() => parseDecomposition('[{"name":"No Spaces.md","content":"x"}]')).toThrow();
    expect(() => parseDecomposition('[{"name":"ok.md","content":"  "}]')).toThrow();
    expect(() => parseDecomposition('{"name":"ok.md","content":"x"}')).toThrow();
  });
});

describe("decompose", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "decompose-test-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("sends the requirements to the decomposer agent and drops each piece", async () => {
    const reqFile = path.join(root, "requirements.md");
    fs.writeFileSync(reqFile, "# Big requirement\nDo A. Do B.");
    const runner = new OneShotRunner({
      ok: true,
      output: JSON.stringify([
        { name: "do-a.md", content: "Do A." },
        { name: "do-b.md", content: "Do B." },
      ]),
    });

    const dropped = await decompose(runner, root, reqFile);

    expect(runner.calls[0]!.agent).toBe("decomposer");
    expect(runner.calls[0]!.prompt).toContain("Do A. Do B.");
    expect(dropped).toEqual(["do-a.md", "do-b.md"]);
    expect(listDropped(queuePaths(root)).sort()).toEqual(["do-a.md", "do-b.md"]);
  });

  it("throws when the decomposer run fails", async () => {
    const reqFile = path.join(root, "requirements.md");
    fs.writeFileSync(reqFile, "x");
    const runner = new OneShotRunner({ ok: false, output: "over limit" });
    await expect(decompose(runner, root, reqFile)).rejects.toThrow(/decomposer failed/);
  });
});
