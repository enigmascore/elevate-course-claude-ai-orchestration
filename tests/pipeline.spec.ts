import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPipeline } from "../orchestration/pipeline.js";
import { atomicDrop, claim, ensureQueue, listStaleClaims, markClaimed, queuePaths } from "../orchestration/queue.js";
import type { AgentRunner, AgentRunResult, RunOptions } from "../orchestration/runner.js";

/** Records every run and answers from a script - the model without the model. */
class FakeRunner implements AgentRunner {
  calls: Array<{ agent: string; prompt: string; options?: RunOptions }> = [];
  constructor(private readonly script: AgentRunResult[]) {}
  async run(agent: string, prompt: string, options?: RunOptions): Promise<AgentRunResult> {
    this.calls.push({ agent, prompt, options });
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

describe("cost caps and stale claims", () => {
  it("hands the caps to every agent run", async () => {
    const runner = new FakeRunner([{ ok: true, output: "" }]);
    const pipeline = createPipeline({ root, runner, maxTurns: 7, timeoutMs: 5000, log: silent });
    atomicDrop(pipeline.paths, "job.md", "x");
    await pipeline.processJob("job.md");
    expect(runner.calls[0]!.options).toEqual({ maxTurns: 7, timeoutMs: 5000 });
  });

  it("the sweep re-queues a claim older than staleAfterMs - a dead worker's job comes back as attempt 2", async () => {
    const runner = new FakeRunner([{ ok: true, output: "" }]);
    const pipeline = createPipeline({ root, runner, staleAfterMs: 1000, log: silent });
    const paths = pipeline.paths;
    // simulate a worker that claimed and died 10 minutes ago
    atomicDrop(paths, "stuck.md", "x");
    claim(paths, "stuck.md");
    markClaimed(paths, "stuck.md", new Date(Date.now() - 10 * 60 * 1000));
    expect(listStaleClaims(paths, 1000)).toEqual(["stuck.md"]);

    await pipeline.sweep();

    // recovered, re-queued as attempt 2, then processed by the sweep's second half
    expect(runner.calls).toHaveLength(1);
    expect(fs.existsSync(path.join(paths.done, "stuck.attempt-2.md"))).toBe(true);
    expect(fs.existsSync(path.join(paths.processing, "stuck.md"))).toBe(false);
  });

  it("a fresh claim is not stale", () => {
    const pipeline = createPipeline({ root, runner: new FakeRunner([{ ok: true, output: "" }]), log: silent });
    atomicDrop(pipeline.paths, "fresh.md", "x");
    claim(pipeline.paths, "fresh.md");
    markClaimed(pipeline.paths, "fresh.md");
    expect(listStaleClaims(pipeline.paths, 60_000)).toEqual([]);
  });
});

