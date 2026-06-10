---
tech: nodejs
tags: [git, ls-files, tooling, enoent, guard-scripts, ci]
severity: medium
---
# Scripts walking `git ls-files` crash on tracked-but-missing files

## PROBLEM
`git ls-files` lists what is in the index, not what is on disk. A file that was staged as added and then deleted from the working tree (git status `AD`) still appears in the listing, so a tooling script that reads every listed file dies with ENOENT. The crash happens precisely in the messy intermediate states (interrupted refactors, a test file cleaned up with `rm` but not `git rm --cached`, partially applied agent edits) that a guard script most needs to survive, and it takes the whole check down instead of reporting on the other files.

## WRONG
```js
const out = execSync("git ls-files -z -- src/*.ts", { encoding: "utf8" });
for (const f of out.split("\0").filter(Boolean)) {
  const buf = fs.readFileSync(f); // throws ENOENT on AD-status files
  // ... count lines, scan content, etc.
}
```

## RIGHT
```js
function readTracked(f) {
  try {
    return fs.readFileSync(f);
  } catch (err) {
    if (err.code === "ENOENT") return null; // in the index but absent on disk
    throw err;
  }
}
for (const f of files) {
  const buf = readTracked(f);
  if (buf === null) continue;
  // ... process
}
```

## NOTES
Hit while building Vigilis' file-size ratchet (`scripts/check-file-size.cjs`): a 701-line test file was staged to verify the failure path, deleted with plain `rm`, and the next run crashed on the stale index entry. Cleanup needs `git rm --cached <file>`. Same applies to any linter/scanner built on `git ls-files` output.
