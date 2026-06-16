---
tech: git
tags: [git, tooling, ci]
severity: medium
---
# git ls-files can't see untracked files

## PROBLEM
Any lint/check/guard that enumerates its targets via `git ls-files` only sees TRACKED files. Newly-created, not-yet-`git add`ed files are invisible to it, so they escape the check entirely and the guard reports a false green. This silently hides real violations: the guard "passes" precisely because the offending file does not exist as far as `git ls-files` is concerned.

Discovered while supervising an autonomous (Antigravity/`agy`) file-splitting refactor: a new 507-line source file violated a 500-line cap, yet `scripts/check-file-size.cjs` reported "file-size ratchet: clean" because the new file was never staged and thus absent from `git ls-files`. (The same run's exit-0 self-report also falsely claimed completion, compounding the blind spot.)

## WRONG
```bash
# Guard enumerates only tracked files; brand-new files are skipped.
for f in $(git ls-files '*.ts' '*.tsx'); do
  check_size "$f"
done
echo "file-size ratchet: clean"   # false green: untracked 507-line file never checked
```

## RIGHT
```bash
# Option A: stage everything first so new files enter the index.
git add -A            # or: git add -N .   (intent-to-add, keeps content unstaged)
for f in $(git ls-files '*.ts' '*.tsx'); do check_size "$f"; done

# Option B: enumerate tracked AND untracked (honoring .gitignore) directly.
for f in $(git ls-files -o -c --exclude-standard '*.ts' '*.tsx'); do
  check_size "$f"
done
```

## NOTES
Applies generally to any grep/lint/audit script scoped to `git ls-files` (tenant-scope checks, secret scans, size ratchets). Before trusting such a guard, either `git add -A` / `git add -N` so new files are indexed, or switch the enumeration to `git ls-files -o -c --exclude-standard` which includes untracked-but-not-ignored files. See also the Antigravity CLI entry on exit-0 self-reports that falsely claim completion.
