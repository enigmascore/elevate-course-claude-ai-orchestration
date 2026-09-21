# Version Toolkit - Requirements

This is a RESOLVED requirements file, in the format this course teaches:
thoughts were distilled into numbered requirements, every open question was
answered and folded into the body, and no Open Questions section remains. It
is written to be MACHINE INPUT: the pipeline's decomposer splits it into one
small requirement per numbered function below, and an implementer agent turns
each one into code.

It relates to:
- `target/version-toolkit.ts` - the CONTRACT: every function below already
  exists there as a typed signature with a throwing stub body. Implement the
  bodies; never change a signature, a type, or an export.
- `tests/gate/version-toolkit/` - one vitest file per function, fully
  written, red until the function is implemented. Never edit these.

## Thoughts ( distilled )

Every package manager carries the same handful of version helpers: parse a
`MAJOR.MINOR.PATCH` string, print one back, order two versions, bump a part,
and check a version against a range like `>=1.2.0 <2.0.0`. The scheme is
called semantic versioning ( "semver" ). We want the smallest complete
toolkit: pure functions, no dependencies, no pre-release or build metadata,
ranges limited to AND-ed comparators. Errors are reported through one class
so callers can catch them in one place.

Decisions folded in ( formerly open questions ):
- Pre-release suffixes ( `1.2.3-beta` ) are OUT: rejected by the parser.
- A single leading `v` IS accepted by the parser ( `v1.2.3` ), and never
  produced by the formatter.
- Leading zeros ( `01.2.3` ) are rejected: each part is `0` or a digit
  string not starting with `0`.
- Ranges support the operators `>=`, `>`, `<=`, `<`, `=` and a bare version
  meaning `=`; comparators are separated by whitespace and ALL must hold.
  `||`, `~`, `^`, `x` and other range syntaxes are OUT and must throw.
- All failures throw `VersionError` ( already defined in the contract ), and
  the message includes the offending input.

## Shared context ( restate this in every small requirement )

- File to edit: `target/version-toolkit.ts`. Replace ONLY the body of the
  named function; leave every signature, the `Version` interface, the
  `BumpPart` type and the `VersionError` class exactly as they are.
- `Version` is `{ major: number; minor: number; patch: number }`, all
  non-negative integers.
- Run the named test file with `pnpm vitest run <path>` and finish only when
  it is green. `pnpm tsc:check` must also stay green.
- Do not edit anything under `tests/`.

## Requirements

### 1. parseVersion

`parseVersion(input: string): Version` turns `"1.4.2"` into
`{ major: 1, minor: 4, patch: 2 }`. Exactly three dot-separated parts, each
`0` or a digit string with no leading zero. One optional leading `v` is
allowed and stripped ( `"v2.0.1"` -> `{ 2, 0, 1 }` ). Anything else -
too few or too many parts, non-digits, a minus sign, a leading zero,
surrounding whitespace, a `-beta` or `+build` suffix, a double `vv`, the
empty string - throws `VersionError` whose message contains the input.

Tests: `tests/gate/version-toolkit/parse-version.spec.ts`.

### 2. formatVersion

`formatVersion(version: Version): string` renders `MAJOR.MINOR.PATCH` with a
`.` between the numbers and no prefix: `{ 1, 4, 2 }` -> `"1.4.2"`,
`{ 0, 0, 0 }` -> `"0.0.0"`.

Tests: `tests/gate/version-toolkit/format-version.spec.ts`.

### 3. compareVersions

`compareVersions(a: Version, b: Version): -1 | 0 | 1` returns `-1` when `a`
is lower than `b`, `1` when higher, `0` when all three parts are equal.
Compare `major` first, then `minor`, then `patch`, NUMERICALLY - so
`1.10.0` is higher than `1.9.0` and `1.0.10` is higher than `1.0.2`.

Tests: `tests/gate/version-toolkit/compare-versions.spec.ts`.

### 4. bumpVersion

`bumpVersion(version: Version, part: BumpPart): Version` returns a NEW
object ( the input is never mutated ) with the named part incremented by one
and every lower part reset to zero: bumping `major` on `1.4.2` gives
`2.0.0`; `minor` gives `1.5.0`; `patch` gives `1.4.3`. Any `part` other
than `"major"`, `"minor"` or `"patch"` throws `VersionError` whose message
contains the offending part.

Tests: `tests/gate/version-toolkit/bump-version.spec.ts`.

### 5. satisfiesRange

`satisfiesRange(version: Version, range: string): boolean` splits `range`
on whitespace into comparators and returns `true` only if EVERY comparator
holds. A comparator is one of `>=`, `>`, `<=`, `<`, `=` immediately followed
by a version string ( `>=1.2.0` ), or a bare version string meaning `=`.
Versions inside a range follow the `parseVersion` rules ( so `>=1.2` is
malformed ). Examples: `1.5.0` satisfies `>=1.2.0 <2.0.0`; `2.0.0` does not;
extra whitespace between comparators is fine. An empty or whitespace-only
range, an operator with no version, an unknown operator ( `~`, `^`, `<>` ),
or any `||` / `x` syntax throws `VersionError`.

This function may call `parseVersion` and `compareVersions` ( sections 1
and 3 ). If either is still a stub when you implement this one, its own
tests will tell you: run them first, and implement what is missing.

Tests: `tests/gate/version-toolkit/satisfies-range.spec.ts`.
