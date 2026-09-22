/**
 * The file-system work queue.
 *
 * Folders are job states; MOVES are the state transitions. Two rules give the
 * queue its reliability, both resting on the same primitive - a rename within
 * one filesystem is atomic:
 *
 *   1. Producers never write into dropped/ directly: they write the file to
 *      tmp/ and RENAME it in, so a watcher can never observe a half-written
 *      job.
 *   2. Workers CLAIM a job by renaming it from dropped/ to processing/. Only
 *      one rename can win, so two workers can never grab the same job.
 */
import fs from "node:fs";
import path from "node:path";

export interface QueuePaths {
  tmp: string;
  dropped: string;
  processing: string;
  done: string;
  failed: string;
}

export function queuePaths(root: string): QueuePaths {
  const q = path.join(root, "queue");
  return {
    tmp: path.join(q, "tmp"),
    dropped: path.join(q, "small", "dropped"),
    processing: path.join(q, "small", "processing"),
    done: path.join(q, "small", "done"),
    failed: path.join(q, "small", "failed"),
  };
}

export function ensureQueue(paths: QueuePaths): void {
  for (const dir of Object.values(paths)) fs.mkdirSync(dir, { recursive: true });
}

/** Write to tmp/, then atomically rename into dropped/. */
export function atomicDrop(paths: QueuePaths, name: string, content: string): string {
  const tmpFile = path.join(paths.tmp, `${process.pid}-${Date.now()}-${name}`);
  fs.writeFileSync(tmpFile, content);
  const target = path.join(paths.dropped, name);
  fs.renameSync(tmpFile, target);
  return target;
}

/**
 * Claim a dropped job by renaming it into processing/. Returns the new path,
 * or null when another worker won the race (the file is already gone).
 */
export function claim(paths: QueuePaths, name: string): string | null {
  const from = path.join(paths.dropped, name);
  const to = path.join(paths.processing, name);
  try {
    fs.renameSync(from, to);
    return to;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function complete(paths: QueuePaths, name: string): void {
  fs.renameSync(path.join(paths.processing, name), path.join(paths.done, name));
}

export function fail(paths: QueuePaths, name: string): void {
  fs.renameSync(path.join(paths.processing, name), path.join(paths.failed, name));
}

/** Re-queue a processing job for another attempt, bumping the attempt counter. */
export function requeue(paths: QueuePaths, name: string): string {
  const next = withAttempt(stripAttempt(name), attemptOf(name) + 1);
  fs.renameSync(path.join(paths.processing, name), path.join(paths.dropped, next));
  return next;
}

export function listDropped(paths: QueuePaths): string[] {
  return fs.readdirSync(paths.dropped).filter((f) => !f.startsWith("."));
}

/** job.md -> 1; job.attempt-3.md -> 3 */
export function attemptOf(name: string): number {
  const m = name.match(/\.attempt-(\d+)\.[^.]+$/);
  return m ? Number(m[1]) : 1;
}

export function stripAttempt(name: string): string {
  return name.replace(/\.attempt-\d+(\.[^.]+)$/, "$1");
}

export function withAttempt(name: string, attempt: number): string {
  if (attempt <= 1) return name;
  const ext = path.extname(name);
  return `${name.slice(0, name.length - ext.length)}.attempt-${attempt}${ext}`;
}

// ---------------------------------------------------------------------------------------------
// Stale claims ( 098 3.4.2 ): a worker that dies mid-job leaves its file in processing/ forever.
// The pipeline stamps a claim with the time it was taken; the sweep re-queues claims older than
// the run's wall-clock cap. Markers live beside the job, never inside it.
// ---------------------------------------------------------------------------------------------

function claimMarker(paths: QueuePaths, name: string): string {
  return path.join(paths.processing, `.${name}.claimed-at`);
}

/** Record when a claimed job was taken ( called right after a successful claim ). */
export function markClaimed(paths: QueuePaths, name: string, at: Date = new Date()): void {
  fs.writeFileSync(claimMarker(paths, name), at.toISOString());
}

export function clearClaimed(paths: QueuePaths, name: string): void {
  fs.rmSync(claimMarker(paths, name), { force: true });
}

/** Jobs in processing/ whose claim is older than `olderThanMs` - a dead worker's leftovers. */
export function listStaleClaims(paths: QueuePaths, olderThanMs: number, now: Date = new Date()): string[] {
  return fs
    .readdirSync(paths.processing)
    .filter((f) => !f.startsWith("."))
    .filter((name) => {
      const marker = claimMarker(paths, name);
      if (!fs.existsSync(marker)) return true; // claimed by a worker that never stamped it - treat as stale
      const claimedAt = Date.parse(fs.readFileSync(marker, "utf8"));
      return Number.isNaN(claimedAt) || now.getTime() - claimedAt > olderThanMs;
    });
}

/** Re-queue a stale claim for another attempt ( the sweep's recovery path ). */
export function recoverStale(paths: QueuePaths, name: string): string {
  clearClaimed(paths, name);
  return requeue(paths, name);
}

