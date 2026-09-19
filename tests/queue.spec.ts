import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  atomicDrop,
  attemptOf,
  claim,
  ensureQueue,
  listDropped,
  queuePaths,
  requeue,
  stripAttempt,
  withAttempt,
} from "../orchestration/queue.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "queue-test-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("atomic drop", () => {
  it("lands the complete file in dropped/ and leaves nothing in tmp/", () => {
    const paths = queuePaths(root);
    ensureQueue(paths);
    const target = atomicDrop(paths, "job.md", "the whole requirement");
    expect(fs.readFileSync(target, "utf8")).toBe("the whole requirement");
    expect(listDropped(paths)).toEqual(["job.md"]);
    expect(fs.readdirSync(paths.tmp)).toEqual([]);
  });
});

describe("claim", () => {
  it("moves the job to processing/", () => {
    const paths = queuePaths(root);
    ensureQueue(paths);
    atomicDrop(paths, "job.md", "x");
    const claimed = claim(paths, "job.md");
    expect(claimed).toBe(path.join(paths.processing, "job.md"));
    expect(listDropped(paths)).toEqual([]);
  });

  it("only one of two competing claims wins", () => {
    const paths = queuePaths(root);
    ensureQueue(paths);
    atomicDrop(paths, "job.md", "x");
    const first = claim(paths, "job.md");
    const second = claim(paths, "job.md");
    expect(first).not.toBeNull();
    expect(second).toBeNull(); // lost the race - by design, not an error
  });
});

describe("attempt bookkeeping", () => {
  it("names and parses attempts", () => {
    expect(attemptOf("job.md")).toBe(1);
    expect(withAttempt("job.md", 2)).toBe("job.attempt-2.md");
    expect(attemptOf("job.attempt-2.md")).toBe(2);
    expect(stripAttempt("job.attempt-3.md")).toBe("job.md");
    expect(withAttempt("job.md", 1)).toBe("job.md");
  });

  it("requeue bumps the attempt and returns the job to dropped/", () => {
    const paths = queuePaths(root);
    ensureQueue(paths);
    atomicDrop(paths, "job.md", "x");
    claim(paths, "job.md");
    const next = requeue(paths, "job.md");
    expect(next).toBe("job.attempt-2.md");
    expect(listDropped(paths)).toEqual(["job.attempt-2.md"]);
  });
});
