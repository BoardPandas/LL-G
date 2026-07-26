---
tech: git
tags: [hooks, pre-push, core.hooksPath, file-mode, chmod, ci, guard-scripts, false-green]
severity: high
---
# A hook committed as mode 100644 is silently skipped

## PROBLEM

Git only runs a hook if the file is **executable**. A hook whose tracked mode is
`100644` is skipped with no warning, no error, and no output. Nothing in the
push looks different from a repo that has no hook at all.

This is a silent-false-green, not an obvious failure, and it survives every
plausible sanity check:

- `ls .githooks/` shows the hook is there.
- `git config core.hooksPath` shows it is set.
- The `hooks:install` script (`git config core.hooksPath .githooks`) exits 0 and
  prints success.
- Running the hook by hand (`.githooks/pre-push`) works perfectly, because you
  are invoking the interpreter yourself and never going through Git's exec path.

So the guard reads as installed and healthy while never having run once, on any
clone, since the day it was committed.

The tell is a guard that *should* be impossible to violate and yet keeps getting
violated. Real case: a repo added a `pre-push` line-cap guard, and over the
following weeks two source files still drifted past the cap and reached `main`.
CI caught them both, which reinforced the wrong conclusion ("CI is the backstop,
the hook must be getting bypassed"). The hook had never fired.

The file mode is **tracked content** in Git (`100644` vs `100755`), so this is
not a local-machine problem. A `chmod +x` that is not committed fixes only the
machine that ran it and leaves every teammate and every fresh clone unguarded.

## WRONG

```bash
# Hook is committed non-executable. Nothing warns you.
$ git ls-files -s .githooks/pre-push
100644 c937cf34... 0	.githooks/pre-push
                  ^^^ not executable -> Git silently skips it

# The install script "succeeds"...
$ pnpm run hooks:install        # -> git config core.hooksPath .githooks
$ git config core.hooksPath
.githooks

# ...and running it by hand works, which is the misleading part:
$ .githooks/pre-push
line-cap FAILED: 1 file(s) over 500 lines:

# But a real push sails straight through:
$ git push origin main
To github.com:org/repo.git
   abc1234..def5678  main -> main       # guard never ran
```

## RIGHT

```bash
# 1. Set the executable bit and COMMIT the mode change, so every clone gets it.
chmod +x .githooks/pre-push
git add .githooks/pre-push
git ls-files -s .githooks/pre-push
# 100755 c937cf34... 0	.githooks/pre-push     <- now executable
git commit -m "fix(hooks): make pre-push executable so the guard actually runs"

# 2. Point Git at the directory (per-clone local config; this is NOT committed,
#    which is exactly why an install script exists).
git config core.hooksPath .githooks

# 3. VERIFY BY VIOLATION. A passing hook proves nothing -- a hook that is never
#    invoked also "passes". Plant a real violation and confirm the push is
#    REJECTED, not merely that the script prints a failure.
printf '%.0sx\n' {1..501} > src/__probe.js
git push --dry-run origin main; echo "exit: $?"     # MUST be non-zero
rm src/__probe.js
```

Guard against the whole class in CI, so a future hook cannot regress to inert:

```bash
# Fails if any file under .githooks/ lacks the executable bit.
git ls-files -s .githooks/ | grep -v '^100755' && {
  echo "hook(s) not executable; Git will silently skip them" >&2; exit 1; }
```

## NOTES

- **`--dry-run` still runs `pre-push`.** That makes it the safe way to prove the
  hook is wired up without actually publishing anything.
- **Verify by violation, never by success.** This is the general lesson and it
  outlives hooks: for any guard whose only job is to fail, a green run is
  indistinguishable from a guard that never executed. The only real test is a
  deliberately-planted violation that must be caught.
- **`core.hooksPath` is local config and is never committed.** Ship an install
  script, and have onboarding docs / CI check that it has been run. Setting it
  is orthogonal to the mode bug: you need both.
- **`core.fileMode=false`** (common on Windows / some mounted filesystems) makes
  Git ignore the executable bit in the worktree, so a `chmod +x` there records
  nothing. On those setups set the mode in the index directly:
  `git update-index --chmod=+x .githooks/pre-push`.
- Hooks created by `git init` in `.git/hooks/` ship executable as `.sample`
  files; a hook added to a *tracked* directory like `.githooks/` gets whatever
  mode the author's editor or `Write` call produced, which is usually `644`.
  That asymmetry is why the tracked-hooks pattern hits this and the default
  `.git/hooks/` layout does not.
- Related: [git ls-files can't see untracked files](git-ls-files-blind-spot.md).
  A guard script called from a hook should enumerate with
  `git ls-files --cached --others --exclude-standard` so a brand-new unstaged
  file still counts. The two bugs compound: an inert hook running a
  blind-spotted script is a guard that is wrong twice over.
