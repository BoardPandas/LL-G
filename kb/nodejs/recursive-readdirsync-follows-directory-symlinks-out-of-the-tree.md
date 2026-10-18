---
tech: nodejs
tags: [fs, readdir, recursive, symlink, lstat, path-traversal, untrusted-input]
severity: high
---
# Recursive readdirSync follows directory symlinks out of the tree

## PROBLEM
`fs.readdirSync(dir, { recursive: true })`, and `fs.promises.readdir` with the same option, descends into symbolic links to directories. Walking a tree you do not control (a pull request's checkout, an unpacked archive, a user's repo), a committed link such as `docs -> ../..` or `notes -> /etc` makes the walk list, and the `readFileSync` after it read, files outside the tree. `withFileTypes` does not help: the link itself has `isSymbolicLink() === true`, but every entry beneath it is reported as an ordinary file or directory, so filtering the results on `isSymbolicLink()` still lets the linked contents through.

## WRONG
```js
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
  if (entry.isSymbolicLink()) continue; // skips "link", not "link/secret/key.txt"
  if (entry.isFile()) index(readFileSync(join(entry.parentPath, entry.name)));
}
```

## RIGHT
```js
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

// One level at a time, entering only real directories. A Dirent reports the link itself,
// so a link to a directory is neither isDirectory() nor isFile().
function filesUnder(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(full));
    else if (entry.isFile()) files.push(full);
    // anything else (a symlink, a socket) is skipped; or refuse the whole run
  }
  return files;
}

// The root can be a link too: check it with lstat, not stat.
if (!lstatSync(root).isDirectory()) throw new Error(`${root} is not a real directory`);
```

## NOTES
- Checked on Node 24.22.0: a tree holding `a/x.md` and `link -> ../outside` gives `['a', 'link', 'a/x.md', 'link/secret', 'link/secret/key.txt']`.
- A link to an ancestor repeats the tree until the OS's symlink-depth limit stops it: 123 entries for a two-entry tree.
- `fs.globSync('**')` listed `link` but did not descend into it.
- A symlinked file read with `readFileSync` also leaves the tree; the walk above never returns one.
