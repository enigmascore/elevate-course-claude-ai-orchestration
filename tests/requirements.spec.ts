/**
 * The three halves of the assignment's target must agree: the resolved
 * requirements file the pipeline consumes, the typed contract it names, and
 * the gate tests. Shipped green, and it STAYS green once the toolkit is
 * implemented - it checks agreement, never the stubs themselves ( the gate
 * suites prove the template's own red state ). A mismatch here is an
 * authoring bug, not a student's.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const requirements = fs.readFileSync(path.join(root, "requirements", "version_toolkit_requirements.md"), "utf8");
const contract = fs.readFileSync(path.join(root, "target", "version-toolkit.ts"), "utf8");

/** "### 1. parseVersion" -> "parseVersion" */
const numbered = [...requirements.matchAll(/^### \d+\. (\w+)$/gm)].map((m) => m[1]!);
const exported = [...contract.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]!);

describe("requirements/version_toolkit_requirements.md", () => {
  it("is resolved: it carries no Open Questions section", () => {
    expect(requirements).not.toMatch(/^## Open Questions/m);
  });

  it("numbers exactly the functions the contract exports, in the contract's order", () => {
    expect(numbered).toEqual(exported);
    expect(numbered.length).toBeGreaterThan(0);
  });

  it("names the contract file and, per function, its own gate test file - which exists", () => {
    expect(requirements).toContain("target/version-toolkit.ts");
    for (const fn of numbered) {
      const kebab = fn.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      const testFile = `tests/gate/version-toolkit/${kebab}.spec.ts`;
      expect(requirements, `section for ${fn} names ${testFile}`).toContain(testFile);
      expect(fs.existsSync(path.join(root, testFile)), `${testFile} exists`).toBe(true);
    }
  });
});
