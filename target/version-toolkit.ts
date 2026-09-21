/**
 * The version toolkit - the semantic-versioning helpers every package manager
 * has (the community calls the scheme "semver": MAJOR.MINOR.PATCH).
 *
 * THIS FILE IS THE CONTRACT, NOT THE IMPLEMENTATION. It ships with every
 * function as a throwing stub so that `tsc` is green from the first clone
 * while the tests under tests/gate/version-toolkit/ are red. The marked
 * assignment does NOT ask you to fill these bodies in yourself: your
 * ORCHESTRATION must generate the implementation, working from
 * requirements/version_toolkit_requirements.md, until every one of those
 * tests is green. The signatures below must not change - the tests import
 * them exactly as written.
 */

/** A parsed MAJOR.MINOR.PATCH version. All three parts are non-negative integers. */
export interface Version {
  major: number;
  minor: number;
  patch: number;
}

/** Which part bumpVersion increments. */
export type BumpPart = "major" | "minor" | "patch";

/**
 * Thrown by every toolkit function that is handed something it cannot work
 * with: an unparseable version string, an unparseable range, an unknown
 * bump part. The message always includes the offending input.
 */
export class VersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VersionError";
  }
}

/**
 * Parse "1.4.2" (or "v1.4.2") into a Version. Anything else - missing
 * parts, extra parts, non-digits, negative numbers, leading zeros such as
 * "01.2.3", surrounding whitespace, a pre-release or build suffix - throws
 * VersionError.
 */
export function parseVersion(input: string): Version {
  throw new Error(`not implemented: parseVersion(${JSON.stringify(input)})`);
}

/** Render a Version as "MAJOR.MINOR.PATCH" - no "v" prefix. */
export function formatVersion(version: Version): string {
  throw new Error(`not implemented: formatVersion(${JSON.stringify(version)})`);
}

/**
 * Order two versions: -1 when a is lower than b, 1 when higher, 0 when equal.
 * Major decides first, then minor, then patch - numerically, so 1.10.0 is
 * higher than 1.9.0.
 */
export function compareVersions(a: Version, b: Version): -1 | 0 | 1 {
  throw new Error(`not implemented: compareVersions(${formatArg(a)}, ${formatArg(b)})`);
}

/**
 * Return a NEW Version with the named part incremented by one and every
 * lower part reset to zero: bumping "major" zeroes minor and patch; bumping
 * "minor" zeroes patch; bumping "patch" resets nothing. The input is never
 * mutated. An unknown part throws VersionError.
 */
export function bumpVersion(version: Version, part: BumpPart): Version {
  throw new Error(`not implemented: bumpVersion(${formatArg(version)}, ${JSON.stringify(part)})`);
}

/**
 * Does `version` satisfy `range`? A range is one or more whitespace-separated
 * comparators that must ALL hold: each is an operator (">=", ">", "<=", "<"
 * or "=") immediately followed by a version, and a bare version means "=".
 * Example: ">=1.2.0 <2.0.0". An empty or malformed range throws VersionError.
 */
export function satisfiesRange(version: Version, range: string): boolean {
  throw new Error(`not implemented: satisfiesRange(${formatArg(version)}, ${JSON.stringify(range)})`);
}

function formatArg(value: unknown): string {
  return JSON.stringify(value);
}
