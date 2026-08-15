---
tech: git
tags: [worktree, symlink, node_modules, dist, build-artifact, false-pass, verification, monorepo]
severity: high
---
# Symlinking `node_modules`/`dist` into an isolated worktree doesn't just hide errors -- it can MANUFACTURE a passing test

## PROBLEM

You did the right thing and isolated your commit in a `git worktree`
(see `concurrent-shared-tree-worktree.md`). The worktree is a fresh checkout, so it has
no `node_modules` and no built `dist/` -- tests cannot run at all. The obvious fix is to
symlink them in from the main tree:

```
ln -sfn /repo/node_modules            wt/node_modules
ln -sfn /repo/proxy-pipeline/dist     wt/proxy-pipeline/dist
```

Those artifacts were built from **whatever branch the main tree happens to be sitting
on** -- which, in the exact situation that made you create a worktree, is somebody
else's in-progress branch. Two failure modes, and the second one is inverted:

1. **Phantom errors (noisy, you notice).** A `dist/` built from a branch that deleted a
   feature yields dozens of `Property 'x' does not exist on type ...` against code that
   is correct on your branch. Annoying, but it fails loudly and you investigate.

2. **A manufactured PASS (silent, you do not notice).** A test whose subject is
   *"did the build run?"* -- asserting a build artifact EXISTS -- fails correctly in the
   clean worktree, and then goes GREEN the moment you symlink the artifact in. You read
   that as "I fixed the worktree." What actually happened is that the assertion was
   handed a foreign artifact and inverted its verdict. The symlink did not conceal a
   failure; it **created** a success.

Mode 2 is the dangerous one because it rewards the symlink. The suite goes from
"1 failed" to "all green" immediately after you add the link, which reads as
confirmation that linking was the correct move.

Consequence: a local suite reported as "236 files, 2822 passing" is not evidence about
your commit at all. It is evidence about a hybrid of your source and another branch's
binaries.

## WRONG

```bash
git worktree add ../wt -b my-fix origin/main
cd ../wt
npx vitest run
#  FAIL  art-gen-worker-client.test.ts
#  missing ../wt/proxy-pipeline/dist/scripts/art-gen-worker.js

ln -sfn /repo/node_modules ./node_modules
ln -sfn /repo/proxy-pipeline/dist ./proxy-pipeline/dist   # "fixes" the worktree
npx vitest run
#  2822 passed          <-- the artifact test now PASSES on a foreign artifact
git push                # pushed on a verification that was never real

# And the cleanup trap:
rm -rf node_modules/    # trailing slash + -rf follows the LINK and deletes the
                        # MAIN TREE's real node_modules
```

## RIGHT

```bash
# Build the leaf packages inside the worktree so the artifacts belong to THIS commit.
git worktree add ../wt -b my-fix origin/main
cd ../wt
pnpm install --frozen-lockfile
pnpm run build:all          # dist/ now reflects the code under test
npx vitest run

# If you must borrow deps to save time, borrow ONLY node_modules -- never a package's
# own build output -- and treat the run as provisional, not as verification.
ln -sfn /repo/node_modules ./node_modules
npx vitest run              # provisional; CI on the pushed SHA is the authority

# Cleanup: -f on the LINK, never -rf on "link/".
rm -f ./node_modules ./proxy-pipeline/dist
git worktree remove --force ../wt
```

```bash
# Tell the two failure shapes apart before believing either:
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "$(basename "$PWD")"   # errors in MY files?
# Errors only in files you did not touch, all about members that exist on your branch,
# = borrowed dist. Not your bug -- and equally, not your green either.
```

## NOTES

- The tell for mode 2: a test flipping fail -> pass because of an environment change you
  made, not a code change. Any test named "the build artifact exists" / "run build:all if
  this fails" is by construction the one a `dist` symlink must never be near.
- Corollary: **CI on the pushed SHA is the only authority**, because it does a clean
  checkout and its own build. A local suite in a borrowed-artifact worktree is weaker
  evidence than it appears, and it appears strong precisely because the number is large.
- Observed twice in one afternoon by two agents independently, in the same repo, both
  having created the worktree for the correct reason. The remedy that avoids the whole
  class is `pnpm install && pnpm run build:all` in the worktree -- slower once, honest
  every time.
- Related: `concurrent-shared-tree-worktree.md` (why you made the worktree),
  `interrupted-rebase-detaches-head.md` (prefer a worktree per agent), and
  `kb/github-actions/red-verify-skips-suite-and-deploy.md` (what a red CI run does and
  does not prove once you stop trusting the local run).
