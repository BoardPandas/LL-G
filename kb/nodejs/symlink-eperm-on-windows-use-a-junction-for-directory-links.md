---
tech: nodejs
tags: [fs, symlink, junction, windows, eperm, tests, cross-platform]
severity: medium
---
# `fs.symlink` fails with EPERM on Windows: use a junction for directory links

## PROBLEM
Creating a symbolic link on Windows needs admin rights or Developer Mode. Without
them `fs.symlink`/`fs.symlinkSync` throws `EPERM: operation not permitted, symlink`.
Code that links directories at runtime (an artifact staging area, a download
emulation) fails outright, and every test that builds a link fixture to prove
"links are rejected" errors before it reaches the assertion.

A directory junction needs no privilege. Node creates one when you pass the type
`'junction'`; that argument is ignored on Linux and macOS, which make an ordinary
symlink. `lstat().isSymbolicLink()` is `true` for a junction, so code that
rejects links rejects it too, and `unlink`/`rm` remove the junction without
touching its target.

A file link has no unprivileged equivalent. Junctions are directory-only.

## WRONG
```js
symlinkSync(join(artifactsDir, name), join(staging, name)); // EPERM on Windows

test('rejects a linked artifact', async () => {
  await symlink(path, path + '.link');             // throws before the assertion
  await assert.rejects(admit(path + '.link'));
});
```

## RIGHT
```js
// Junction on Windows (no admin needed); the type is ignored elsewhere.
const linkDirectory = (target, link) => symlinkSync(target, link, 'junction');

// File links: probe once, and gate only the checks that need one.
export const fileSymlinksAllowed = (() => {
  if (process.platform !== 'win32') return true;
  const dir = mkdtempSync(join(tmpdir(), 'symlink-probe-'));
  try { symlinkSync('target', join(dir, 'link'), 'file'); return true; }
  catch (error) { if (error.code === 'EPERM') return false; throw error; }
  finally { rmSync(dir, { recursive: true, force: true }); }
})();

if (fileSymlinksAllowed) {
  await symlink(path, path + '.link');
  await assert.rejects(admit(path + '.link'));
}
```

## NOTES
- A junction target must be absolute; Node resolves a relative one for you.
- Gate on the probe, not on `process.platform`, so a Windows machine with
  Developer Mode still runs the file-link checks, and rethrow anything but EPERM.
- Code that must refuse links has to treat junctions as links. Node's
  `isSymbolicLink()` does; Go's `ModeSymlink` does not always (see
  `kb/windows/go-mode-symlink-misses-windows-reparse-points.md`).
