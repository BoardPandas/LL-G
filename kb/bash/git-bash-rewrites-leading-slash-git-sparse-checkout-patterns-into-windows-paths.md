---
tech: bash
tags: [git, sparse-checkout, msys, git-bash, windows, path-conversion]
severity: high
---
# Git Bash rewrites leading-slash git sparse-checkout patterns into Windows paths, so the checkout silently matches nothing

## PROBLEM
Under Git Bash (MSYS), a non-cone sparse-checkout pattern like `'/.github/'` is rewritten to `C:/Program Files/Git/.github/` before git sees it, so the checkout matches no files.
Nothing reports an error. `git status` says "working tree clean" plus "sparse checkout with 0% of tracked files present", so it looks like a successful empty checkout. Quoting the pattern does not stop the conversion, because MSYS rewrites any argument that starts with `/`. Anchored non-cone patterns always start with `/`, so every anchored pattern is affected.

## WRONG
```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/org/repo.git repo
cd repo
git sparse-checkout set --no-cone '/.github/' '/package.json'
git sparse-checkout list   # C:/Program Files/Git/.github/ ...
ls .github                 # No such file or directory
```

## RIGHT
```bash
MSYS_NO_PATHCONV=1 git sparse-checkout set --no-cone '/.github/' '/package.json'
git sparse-checkout list   # /.github/  /package.json
```
After any sparse-checkout `set` or `add` on Windows, check the stored patterns with `git sparse-checkout list`.

## NOTES
- The same applies to `git sparse-checkout add`.
- Set `MSYS_NO_PATHCONV=1` on this command only, not with `export`. See `msys-no-pathconv-breaks-jq-file-args` for why a global export breaks native tools.
- Related: `msys-path-conversion-corrupts-jq-arg`.
