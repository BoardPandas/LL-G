---
tech: claude-code
tags: [guard, ci, worktrees, vacuous-pass, path-exclusion, fail-closed, nodejs]
severity: high
---
# A guard that excludes by absolute path passes vacuously from a checkout under the excluded directory

## PROBLEM
Config guards and lint scripts usually skip `node_modules`, `.git` and stale agent worktrees
(`.claude/worktrees/`) with a path regex or `p.includes(...)`. If that test runs against the
ABSOLUTE path, it also matches the checkout's own location whenever the repo itself sits under an
excluded directory. Claude Code agent and session worktrees all live at
`.claude/worktrees/<name>/`, so from any of them every rule, hook script, agent and skill is
excluded. Every check then loops over an empty list, and the guard prints its success line.

Observed 2026-10-07 in a `check-claude-wiring.mjs` run from `.claude/worktrees/<name>`:
"Rules scanned 0 / Hook scripts scanned 0 ... OK -- .claude wiring verified." Nothing looks
wrong unless someone reads the counts. The BP template `practices/claude-config/verify-claude-wiring-in-ci.md`
uses the same absolute-path substring exclusion (`p.includes("node_modules")`), so repos built from
it probably have this bug too.

## WRONG
```js
const ROOT = process.cwd();
const EXCLUDED = /(^|\/)(node_modules|\.git|\.claude\/worktrees)(\/|$)/;
// walk() returns absolute paths: /repo/.claude/worktrees/x/.claude/rules/a.md -> excluded
const notExcluded = (p) => !EXCLUDED.test(p.split("\\").join("/"));
const rules = walk(join(ROOT, ".claude/rules")).filter(notExcluded); // [] from a worktree
// ... every check iterates zero times; exit 0
```

## RIGHT
```js
const rel = (p) => (relative(ROOT, p) || p).split("\\").join("/");
// Judge only the part of the path INSIDE the checked repo. resolve() accepts both
// absolute walk results and cwd-relative globSync results.
const notExcluded = (p) => !EXCLUDED.test(rel(resolve(ROOT, p)));

// Fail closed: count files on disk by a route independent of walk()+filter.
for (const [dir, suffix, scanned] of [[".claude/rules", ".md", rules] /* , ... */]) {
  if (!existsSync(join(ROOT, dir)) || scanned.length > 0) continue;
  const onDisk = readdirSync(join(ROOT, dir), { recursive: true }).filter((n) => n.endsWith(suffix)).length;
  if (onDisk > 0) errors.push(`${dir} holds ${onDisk} *${suffix} file(s), but the guard scanned none`);
}
```

## NOTES
- Regression-test it both ways. Copy a passing fixture to `<tmp>/.claude/worktrees/x`, run the guard
  with that cwd, and assert that the scan counts are nonzero and that a planted defect still fails.
  Also check that a worktree nested inside the checked repo is still excluded: use a `paths:` glob
  that only matches inside it, and expect "matches 0 files".
- Print scan counts in the guard's report, because "OK" with 0 scanned is easy to overlook.
- Same class of problem as `hook-existence-check-misses-project-dir-prefix` (a guard passing
  vacuously) and `hook-script-cwd-relative-path` (a path that depends on where the checkout is).
- Fixed in BoardPandas/fandom v0.10.6 (ead2e14).
