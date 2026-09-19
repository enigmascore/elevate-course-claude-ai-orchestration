/**
 * The decomposer: give an agent a RESOLVED requirements file and have it
 * split the work into small, independent requirement files, each dropped
 * into the queue for an implementer to claim.
 *
 * Note the division of labour: the AGENT does the judgment work (how to
 * split), while THIS code does the deterministic work (writing files via
 * tmp/ + atomic rename). Agents decide; plumbing moves.
 *
 * Run it:  pnpm decompose <path-to-requirements.md>
 */
import fs from "node:fs";
import path from "node:path";
import { atomicDrop, ensureQueue, queuePaths } from "./queue.js";
import { ClaudeRunner, type AgentRunner } from "./runner.js";

export interface SmallRequirement {
  name: string;
  content: string;
}

export function parseDecomposition(output: string): SmallRequirement[] {
  // The agent is instructed to answer with ONLY a JSON array; tolerate a
  // fenced code block around it.
  const trimmed = output.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) throw new Error("decomposer did not return a JSON array");
  return parsed.map((item, i) => {
    const { name, content } = item as { name?: unknown; content?: unknown };
    if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*\.md$/.test(name))
      throw new Error(`item ${i}: name must be a kebab-case .md filename`);
    if (typeof content !== "string" || content.trim().length === 0)
      throw new Error(`item ${i}: content must be a non-empty string`);
    return { name, content };
  });
}

export async function decompose(
  runner: AgentRunner,
  root: string,
  requirementsPath: string,
): Promise<string[]> {
  const paths = queuePaths(root);
  ensureQueue(paths);
  const requirements = fs.readFileSync(requirementsPath, "utf8");

  const result = await runner.run(
    "decomposer",
    [
      "Split the following resolved requirements document into SMALL,",
      "independent requirement files, each implementable on its own.",
      "Answer with ONLY a JSON array of objects shaped",
      '[{"name": "kebab-case-name.md", "content": "..."}] and nothing else.',
      "",
      requirements,
    ].join("\n"),
  );
  if (!result.ok) throw new Error(`decomposer failed: ${result.output}`);

  const dropped: string[] = [];
  for (const req of parseDecomposition(result.output)) {
    atomicDrop(paths, req.name, req.content);
    dropped.push(req.name);
  }
  return dropped;
}

async function main(): Promise<void> {
  const requirementsPath = process.argv[2];
  if (!requirementsPath) {
    console.error("usage: pnpm decompose <path-to-requirements.md>");
    process.exit(1);
  }
  const root = path.resolve(import.meta.dirname, "..");
  const names = await decompose(new ClaudeRunner(root), root, requirementsPath);
  console.error(`dropped ${names.length} small requirement(s): ${names.join(", ")}`);
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  void main();
}
