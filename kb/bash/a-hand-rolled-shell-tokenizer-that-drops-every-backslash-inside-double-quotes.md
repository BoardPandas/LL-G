---
tech: bash
tags: [tokenizer, git-bash, windows-paths, hooks, fail-open, quoting]
severity: high
---
# A hand-rolled shell tokenizer that drops every backslash inside double quotes silently breaks Windows paths

## PROBLEM
A character-walking tokenizer that treats `\` inside double quotes as escaping the next character turns `"C:\Users\x"` into `C:Usersx`, so any hook that reads a target directory out of a command never resolves a Windows path.
Bash only removes a backslash inside double quotes when the next character is `$`, `` ` ``, `"`, `\` or a newline; everything else keeps the backslash. A second trap usually sits beside it: a path resolver that treats only `/*` as absolute joins `C:/x` onto the cwd as if it were relative. Callers that fail open (allow when the target cannot be found) then hide both bugs completely: a commit gate waves the commit through and an advisory hook says nothing. Linux CI only ever sees `/x` paths, so it stays green while Windows silently loses the check.

## WRONG
```bash
if [ "$q" = '"' ] && [ "$ch" = '\' ]; then
  tok+=${cmd:i:1}; i=$((i + 1))      # drops the backslash before ANY char
fi

resolve_dir() {
  case "$2" in
    /*) printf '%s' "$2" ;;
    *)  printf '%s/%s' "$1" "$2" ;;   # C:/repo becomes $PWD/C:/repo
  esac
}
```

## RIGHT
```bash
if [ "$q" = '"' ] && [ "$ch" = '\' ]; then
  case "${cmd:i:1}" in
    '$'|'`'|'"'|'\'|$'\n') tok+=${cmd:i:1}; i=$((i + 1)) ;;
    *) tok+=$ch ;;                    # keep it, as bash does
  esac
fi

resolve_dir() {
  case "$2" in
    /*|[A-Za-z]:/*|[A-Za-z]:\\*) printf '%s' "$2" ;;
    *) printf '%s/%s' "$1" "$2" ;;
  esac
}
```

## NOTES
Test the tokenizer by sourcing it and calling the functions directly with values passed as positional arguments, so the test runs on Linux CI without Windows paths on disk and cannot mangle its own input. Compare its output against `printf '[%s]\n'` from real bash. Related: bash/git-bash-spells-one-directory-several-ways-so-path-compares-silently-never-match, claude-code/hook-cwd-is-not-the-commit-target-repo.
