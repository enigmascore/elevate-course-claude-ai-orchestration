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
  complete,
  ensureQueue,
  fail,
  listDropped,
  queuePaths,
  requeue,
  type QueuePaths,
} from "./queue.js";
import { ClaudeRunner, type AgentRunner } from "./runner.js";

export interface PipelineOptions {
  root: string;
  runner: AgentRunner;
  maxAttempts?: number;
  implementerAgent?: string;
  sweepIntervalMs?: number;
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
  const log = opts.log ?? ((line: string) => console.error(line));
  ensureQueue(paths);

  async function processJob(name: string): Promise<"done" | "requeued" | "failed" | "lost-race"> {
    const claimed = claim(paths, name);
    if (claimed === null) return "lost-race"; // another worker won - by design, not an error
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
    );

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
    log(`pipeline watching ${paths.dropped}`);

    return async () => {
      clearInterval(interval);
      await watcher.close();
      await busy;
    };
  }

  return { paths, processJob, sweep, start };
}

async function main(): Promise<void> {
  const root = path.resolve(import.meta.dirname, "..");
  const pipeline = createPipeline({ root, runner: new ClaudeRunner(root) });
  await pipeline.start();
  // Keep running until Ctrl+C.
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  void main();
}

export { atomicDrop };
