---
tech: git
tags: [git-log, history-simplification, merge, ledger, append-only, guard-script]
severity: high
---
# git log -- path hides one side of a merge, so history checks miss merge-time drops

## PROBLEM
`git log -- <path>` uses default history simplification: at a merge that is TREESAME to one parent for that path, git follows only that parent and prunes the other side. If a merge resolves a file to one side's version, the other side's commits that changed the file are not listed at all. Adding `--diff-filter` makes it worse, because a merge with no `-m`/`-c` shows no diff and is not listed either.

A guard built on it, for example "every entry ever committed to `ledger.json` must still be present", misses exactly the dangerous case: a merge that drops an entry the other branch recorded passes with exit 0. A regression test in Roundtable proved the `git log` walk missed it.

## WRONG
```js
const commits = git(["log", "--reverse", "--diff-filter=d", "--format=%H", "--", LEDGER])
  .split("\n").filter(Boolean);
for (const c of commits) versions.push(git(["show", `${c}:${LEDGER}`]));
```

## RIGHT
```js
// Every reachable commit, no simplification; one process resolves the path in all of them.
const commits = git(["rev-list", "--reverse", "--topo-order", "HEAD"]).split("\n").filter(Boolean);
const lines = git(["cat-file", "--batch-check=%(objectname) %(objecttype)"],
  commits.map((c) => `${c}:${LEDGER}\n`).join("")).split("\n").filter(Boolean);
if (lines.length !== commits.length) throw new Error("cat-file answered too few lines");
// "<sha> blob" -> a version (dedupe by blob); "<c>:<path> missing" -> not in that commit
```

## NOTES
- Fail closed on a shallow clone (`git rev-parse --is-shallow-repository`); CI needs `fetch-depth: 0`.
- With every reachable commit counted, a colliding change must be fixed by rebasing the branch, never inside a merge commit.
- Under a git hook, strip inherited `GIT_*` env in test fixtures, or fixture git calls hit the real repo.
