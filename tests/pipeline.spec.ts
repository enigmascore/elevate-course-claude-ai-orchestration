import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPipeline } from "../orchestration/pipeline.js";
import { atomicDrop, ensureQueue, queuePaths } from "../orchestration/queue.js";
import type { AgentRunner, AgentRunResult } from "../orchestration/runner.js";

/** Records every run and answers from a script - the model without the model. */
class FakeRunner implements AgentRunner {
  calls: Array<{ agent: string; prompt: string }> = [];
  constructor(private readonly script: AgentRunResult[]) {}
  async run(agent: string, prompt: string): Promise<AgentRunResult> {
    this.calls.push({ agent, prompt });
    return this.script[Math.min(this.calls.length, this.script.length) - 1]!;
  }
}

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-test-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const silent = () => {};

describe("processJob", () => {
  it("claims, runs the implementer with the file content, and completes", async () => {
    const runner = new FakeRunner([{ ok: true, output: "did it" }]);
    const pipeline = createPipeline({ root, runner, log: silent });
    atomicDrop(pipeline.paths, "add-thing.md", "Add the thing.");

    const outcome = await pipeline.processJob("add-thing.md");

    expect(outcome).toBe("done");
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]!.agent).toBe("implementer");
    expect(runner.calls[0]!.prompt).toContain("Add the thing.");
    expect(fs.existsSync(path.join(pipeline.paths.done, "add-thing.md"))).toBe(true);
  });

  it("reports lost-race when the job was already claimed", async () => {
    const runner = new FakeRunner([{ ok: true, output: "" }]);
    const pipeline = createPipeline({ root, runner, log: silent });
    atomicDrop(pipeline.paths, "job.md", "x");
    await pipeline.processJob("job.md");

    expect(await pipeline.processJob("job.md")).toBe("lost-race");
    expect(runner.calls).toHaveLength(1);
  });

  it("re-queues a failed run and fails the job after maxAttempts", async () => {
    const runner = new FakeRunner([{ ok: false, output: "boom" }]);
    const pipeline = createPipeline({ root, runner, maxAttempts: 2, log: silent });
    atomicDrop(pipeline.paths, "job.md", "x");

    expect(await pipeline.processJob("job.md")).toBe("requeued");
    expect(await pipeline.processJob("job.attempt-2.md")).toBe("failed");
    expect(fs.existsSync(path.join(pipeline.paths.failed, "job.attempt-2.md"))).toBe(true);
    expect(runner.calls).toHaveLength(2);
  });
});

describe("sweep", () => {
  it("processes jobs that were dropped while nothing was watching", async () => {
    const paths = queuePaths(root);
    ensureQueue(paths);
    atomicDrop(paths, "a.md", "A");
    atomicDrop(paths, "b.md", "B");

    const runner = new FakeRunner([{ ok: true, output: "" }]);
    const pipeline = createPipeline({ root, runner, log: silent });
    await pipeline.sweep();

    expect(runner.calls).toHaveLength(2);
    expect(fs.readdirSync(paths.done).sort()).toEqual(["a.md", "b.md"]);
  });
});

describe("watcher", () => {
  it("picks up a job dropped after start()", async () => {
    const runner = new FakeRunner([{ ok: true, output: "" }]);
    const pipeline = createPipeline({ root, runner, sweepIntervalMs: 60_000, log: silent });
    const stop = await pipeline.start();
    try {
      atomicDrop(pipeline.paths, "late.md", "late job");
      await waitFor(() => fs.existsSync(path.join(pipeline.paths.done, "late.md")));
      expect(runner.calls).toHaveLength(1);
    } finally {
      await stop();
    }
  });
});

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}
