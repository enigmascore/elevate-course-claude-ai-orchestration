/**
 * The file-based pipeline: watch queue/small/dropped, claim each small
 * requirement atomically, hand it to the implementer agent, and file the
 * outcome.
 *
 * The WATCHER is a convenience, not a correctness mechanism: a duplicate
 * event loses the claim race, and a missed event is caught by the periodic
 * sweep. Correctness rests entirely on the atomic moves in queue.ts.
 *
 * Run it:  pnpm pipeline
 */
import chokidar from "chokidar";
import fs from "node:fs";
import path from "node:path";
import {
  atomicDrop,
  attemptOf,
  claim,
  clearClaimed,
  complete,
  ensureQueue,
  fail,
  listDropped,
  listStaleClaims,
  markClaimed,
  queuePaths,
  recoverStale,
  requeue,
  type QueuePaths,
} from "./queue.js";
import { ClaudeRunner, DEFAULT_MAX_TURNS, DEFAULT_TIMEOUT_MS, SANDBOX_REFUSAL, insideSandbox, type AgentRunner } from "./runner.js";

export interface PipelineOptions {
  root: string;
  runner: AgentRunner;
  maxAttempts?: number;
  implementerAgent?: string;
  sweepIntervalMs?: number;
  /** Cost caps handed to every agent run ( 098 3.4.3 ). */
  maxTurns?: number;
  timeoutMs?: number;
  /** A claim older than this is a dead worker's; the sweep re-queues it. Default: timeoutMs + 1 min. */
  staleAfterMs?: number;
  log?: (line: string) => void;
}

export interface Pipeline {
  paths: QueuePaths;
  /** Claim + process one dropped job by name. Returns what happened. */
  processJob(name: string): Promise<"done" | "requeued" | "failed" | "lost-race">;
  /** Process everything currently sitting in dropped/ (the sweep). */
  sweep(): Promise<void>;
  /** Start watching; returns a stop function. */
  start(): Promise<() => Promise<void>>;
}

export function createPipeline(opts: PipelineOptions): Pipeline {
  const paths = queuePaths(opts.root);
  const maxAttempts = opts.maxAttempts ?? 3;
  const agent = opts.implementerAgent ?? "implementer";
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleAfterMs = opts.staleAfterMs ?? timeoutMs + 60_000;
  const log = opts.log ?? ((line: string) => console.error(line));
  ensureQueue(paths);

  async function processJob(name: string): Promise<"done" | "requeued" | "failed" | "lost-race"> {
    const claimed = claim(paths, name);
    if (claimed === null) return "lost-race"; // another worker won - by design, not an error
    markClaimed(paths, name);
    const attempt = attemptOf(name);
    log(`claimed ${name} (attempt ${attempt}/${maxAttempts})`);

    const requirement = fs.readFileSync(claimed, "utf8");
    const result = await opts.runner.run(
      agent,
      [
        `Implement the following small requirement in this repository.`,
        `When you are done, everything you changed must be saved to disk.`,
        ``,
        requirement,
      ].join("\n"),
      { maxTurns, timeoutMs },
    );
    clearClaimed(paths, name);

    // NOTE: "success" here is the AGENT saying it succeeded - nothing runs the
    // job's tests. That is deliberate: the shipped pipeline is open-loop, and
    // building the TEST GATE (run the job's tests, re-queue on red, fail after
    // maxAttempts) is part of the marked assignment.
    if (result.ok) {
      complete(paths, name);
      log(`done ${name}`);
      return "done";
    }
    if (attempt < maxAttempts) {
      const next = requeue(paths, name);
      log(`retrying ${name} -> ${next}`);
      return "requeued";
    }
    fail(paths, name);
    log(`FAILED ${name} after ${attempt} attempts`);
    return "failed";
  }

  async function sweep(): Promise<void> {
    // 098 3.4.2: a dead worker's claim is not lost - it comes back as another attempt.
    for (const name of listStaleClaims(paths, staleAfterMs)) {
      const next = recoverStale(paths, name);
      log(`stale claim ${name} (older than ${Math.round(staleAfterMs / 1000)}s) -> re-queued as ${next}`);
    }
    for (const name of listDropped(paths)) {
      await processJob(name);
    }
  }

  async function start(): Promise<() => Promise<void>> {
    const watcher = chokidar.watch(paths.dropped, { ignoreInitial: true, depth: 0 });
    let busy = Promise.resolve();
    const enqueue = (name: string) => {
      // Serialise processing; a queue of one worker keeps the demo legible.
      busy = busy.then(() => processJob(name)).then(() => undefined);
    };
    watcher.on("add", (file) => enqueue(path.basename(file)));
    await new Promise<void>((resolve, reject) => {
      watcher.once("ready", () => resolve());
      watcher.once("error", (err) => reject(err instanceof Error ? err : new Error(String(err))));
    });

    const interval = setInterval(() => {
      busy = busy.then(sweep);
    }, opts.sweepIntervalMs ?? 30_000);

    await sweep(); // anything dropped while we were not running
    log(`pipeline watching ${paths.dropped} (caps: ${maxTurns} turns, ${timeoutMs / 1000}s per run, ${maxAttempts} attempts)`);

    return async () => {
      clearInterval(interval);
      await watcher.close();
      await busy;
    };
  }

  return { paths, processJob, sweep, start };
}

async function main(): Promise<void> {
  if (!insideSandbox()) {
    console.error(SANDBOX_REFUSAL);
    process.exit(1);
  }
  const root = path.resolve(import.meta.dirname, "..");
  const pipeline = createPipeline({ root, runner: new ClaudeRunner(root) });
  await pipeline.start();
  // Keep running until Ctrl+C.
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  void main();
}

export { atomicDrop };
