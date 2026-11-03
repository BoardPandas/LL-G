---
tech: bash
tags: [msys, git-bash, windows, git-show, path-conversion]
severity: medium
---
# Git Bash rewrites `git show origin/main:path` into `origin\main;path`, and MSYS_NO_PATHCONV then breaks `-C /c/...` paths

## PROBLEM
In Git Bash, `git show origin/main:.claude/rules/x.md` fails with "ambiguous argument 'origin\main;.claude\rules\x.md'", because MSYS treats `a/b:c/d` as a POSIX path list and converts it.
Setting `MSYS_NO_PATHCONV=1` fixes the revision spec but stops converting `-C /c/repos/x`, which then fails with "cannot change to '/c/...'".

## WRONG
```bash
git -C /c/repos/x show origin/main:.claude/rules/x.md
```

## RIGHT
```bash
MSYS_NO_PATHCONV=1 git -C C:/repos/x show origin/main:.claude/rules/x.md
```

## NOTES
Related: msys-path-conversion-corrupts-jq-arg, msys-no-pathconv-breaks-jq-file-args.
