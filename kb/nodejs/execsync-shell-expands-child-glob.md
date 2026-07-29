---
tech: nodejs
tags: [child-process, execsync, execfilesync, glob, shell, git, pathspec, ci, guard-script, false-green]
severity: high
---
# execSync lets the shell eat a glob meant for the child program

## PROBLEM
`child_process.execSync(cmd)` runs `cmd` through `/bin/sh -c`. Any unquoted glob in that string is expanded **by the shell, against the working directory**, before the child program ever runs. When the child does its own pattern matching — `git ls-files -- <pathspec>`, `find -name`, `rsync --include`, `grep --include` — the pattern it was supposed to interpret has already been replaced with a literal file list.

The two glob dialects disagree in exactly the way that hides the bug: **a git pathspec's `*` crosses `/` (it matches recursively); a shell's `*` does not.** So `src/*.ts`, intended as "every .ts under src", is handed to git as whatever handful of `.ts` files sit directly in `src/`.

What makes this survive review is that the damage is **per-argument, and depends on whether the shell happened to find a match**. Measured on one repo with `execSync("git ls-files -z -- src/*.ts src/*.tsx worker/*.ts")`:

| pathspec | shell-expanded | git pathspec | outcome |
|---|---|---|---|
| `src/*.ts` | **1** | 1920 | shell matched one top-level file; 1919 never scanned |
| `src/*.tsx` | 960 | 960 | **accidentally correct** — no top-level match, so POSIX sh passed the pattern through literally and git did the matching |
| `worker/*.ts` | 63 | 77 | 14 silently dropped |

Total: **1024 of 2957 files, ~35% coverage** — reported as a clean pass. The middle row is the trap: `.tsx` files genuinely were being checked, so spot-checking the guard confirmed it "works".

The shell's behaviour on no-match is itself unportable, so the wrong answer is not even stable:

- POSIX `sh` / bash default: unmatched pattern passes through **literally** → git matches recursively (correct by accident).
- bash with `nullglob`: unmatched pattern **vanishes** → `git ls-files --` with no pathspec → **every tracked file in the repo** (4807 here, including non-TS).
- bash with `failglob`: non-zero exit → the guard dies instead.

Discovered when a file-size ratchet in CI was passing on every run; switching to `execFileSync` surfaced 5 files that had grown past a 500-line cap while unscanned.

## WRONG
```js
const { execSync } = require("node:child_process");

// /bin/sh expands these three patterns before git sees them.
const out = execSync("git ls-files -z -- src/*.ts src/*.tsx worker/*.ts", {
  cwd: ROOT,
  encoding: "utf8",
});
return out.split("\0").filter(Boolean);   // silently ~1/3 of the intended files
```

Quoting inside the command string works but is fragile — one careless edit that drops the quotes reintroduces the bug with no error:

```js
execSync("git ls-files -z -- 'src/*.ts' 'src/*.tsx'");  // correct, but load-bearing quotes
```

## RIGHT
Pass argv as an array so no shell is involved and each pattern reaches the child verbatim:

```js
const { execFileSync } = require("node:child_process");

// execFileSync, not execSync: a shell would glob-expand these patterns before
// git ever sees them, collapsing each recursive pathspec down to whatever
// happens to sit at the top of that directory.
const out = execFileSync(
  "git",
  ["ls-files", "-z", "--", "src/*.ts", "src/*.tsx", "worker/*.ts"],
  { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
return out.split("\0").filter(Boolean);
```

Then assert the guard's own coverage, so a future regression fails loudly instead of passing quietly:

```js
const files = listFiles();
if (files.length < EXPECTED_FLOOR) {
  throw new Error(`file scan returned only ${files.length} files -- pathspec broken?`);
}
```

Verify the mechanism directly whenever a guard's file count looks low:

```bash
git ls-files -- 'src/*.ts' | wc -l      # 1920  -- git does the matching
sh -c 'git ls-files -- src/*.ts' | wc -l  #    1  -- the shell already did
```

## NOTES
- **The rule:** if any argument contains a pattern the *child program* is meant to interpret, use `execFileSync`/`spawnSync` with an argv array. Reach for `execSync` only when you actually want shell features (pipes, redirection, `&&`) — and then quote every pattern.
- **`*` crossing `/` is git-specific and easy to misread.** Git matches pathspecs with fnmatch *without* `FNM_PATHNAME`, so `src/*.ts` is recursive. Anyone reading the string as a shell glob will conclude it means "top level only" and see nothing wrong.
- **A guard that under-scans is indistinguishable from one that passes.** The only signal is the file count, and nothing prints it. Log the number of files scanned, or assert a floor — the same lesson as [git ls-files can't see untracked files](../git/git-ls-files-blind-spot.md), which is a *different* cause of a false green in this same class of script.
- **The bug is invisible to `git diff` review.** `execSync("... src/*.ts ...")` and `execFileSync("git", [..., "src/*.ts"])` look equivalent at a glance; nothing in the string signals that one of them delegates matching to a shell.
- Same script family, third distinct blind spot: see also [Scripts walking `git ls-files` crash on tracked-but-missing files](git-ls-files-missing-on-disk.md). Guard scripts that enumerate via git accumulate these — treat "what exactly does my file list contain?" as the first question, not the last.
- `execSync` on Windows uses `cmd.exe`, which does **no** glob expansion at all, so this code can be correct on Windows and wrong on Linux/macOS — a CI-only failure if developers are on different platforms.
