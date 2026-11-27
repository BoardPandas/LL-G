---
tech: git
tags: [ls-files, guards, deleted-files, staging, enoent, source-scan]
severity: medium
---
# `git ls-files` still lists a deleted file until the deletion is staged, so guards that read each listed file crash

## PROBLEM
`git ls-files` reports the index, not the working tree. A tracked file that has been deleted on disk but whose deletion is not yet staged is still listed. A guard or test that enumerates files with `git ls-files` and then opens each one fails with `ENOENT` on that path.

The failure looks unrelated to the change. A file-length guard and a jest source scan both crashed this way after another task deleted a component, and the stack trace named a file nobody was editing. Staging the deletion makes both pass, which makes it look flaky.

This is the mirror image of [git ls-files can't see untracked files](git-ls-files-blind-spot.md): that one misses new files, this one keeps old ones.

## WRONG
```js
const files = execFileSync('git', ['ls-files', 'src']).toString().split('\n').filter(Boolean)
for (const file of files) check(readFileSync(file, 'utf8')) // ENOENT on a deleted, unstaged path
```

## RIGHT
```js
// Skip paths the working tree no longer has; the deletion is not this guard's business.
const files = execFileSync('git', ['ls-files', 'src']).toString().split('\n').filter(Boolean)
for (const file of files) {
  if (!existsSync(file)) continue
  check(readFileSync(file, 'utf8'))
}
```

## NOTES
- When you hit this in someone else's guard, stage the deletion (`git add -A <path>` or `git rm`) and re-run before investigating anything else.
- It bites hardest when several agents or people share one working tree: one deletes a file, another's unrelated check fails.
- `git ls-files --deleted` lists exactly the affected paths.
