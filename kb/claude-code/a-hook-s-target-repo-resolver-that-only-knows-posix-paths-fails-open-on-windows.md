---
tech: claude-code
tags: [hooks, pretooluse, windows, git-bash, paths, fail-open, commit-gate]
severity: high
---
# A hook's target-repo resolver that only knows POSIX paths fails open on Windows

## PROBLEM
A PreToolUse gate that works out which repo a command targets (from a leading `cd` or
`git -C`) is usually written to fail open: if it cannot resolve the target, it allows
the command. On Windows the resolver often cannot resolve it, and nothing reports that:

- A drive-letter path such as `C:/repo` or `C:\repo` does not start with `/`, so the
  resolver treats it as relative and glues it onto the cwd
  (`/c/session/C:/repo`). That directory does not exist, the resolver fails, and the
  gate allows the commit.
- A hand-rolled tokenizer that drops every backslash inside double quotes turns
  `"C:\Users\me\repo"` into `C:Usersmerepo`, with the same result.

On Windows, `cd C:/repo && git commit` and `git -C "C:\repo" commit` both skipped the
changelog check without any error. The hook's tests passed on Linux and macOS, because
those temp directories have no drive letter or backslash. On Windows the tests failed,
and it looked like a problem with the test environment.

## WRONG
```bash
resolve_dir() {
  case "$2" in
    /*) printf '%s' "$2" ;;            # only POSIX paths count as absolute
    *)  printf '%s/%s' "$1" "$2" ;;    # C:/repo becomes $cwd/C:/repo
  esac
}
# tokenizer, inside double quotes:
elif [ "$q" = '"' ] && [ "$ch" = '\' ]; then tok+=${cmd:i:1}; i=$((i + 1))   # always eats the backslash
```

## RIGHT
```bash
resolve_dir() {
  case "$2" in
    /*)              printf '%s' "$2" ;;
    [A-Za-z]:[/\\]*) printf '%s' "$2" ;;   # Windows drive paths are absolute too
    *)               printf '%s/%s' "$1" "$2" ;;
  esac
}
# Like bash: inside double quotes a backslash escapes only $ ` " \ and newline
elif [ "$q" = '"' ] && [ "$ch" = '\' ] &&
     case ${cmd:i:1} in '$'|'`'|'"'|'\'|$'\n') true ;; *) false ;; esac; then
  tok+=${cmd:i:1}; i=$((i + 1))
```

Test the parser directly with drive-letter and backslash inputs, so the tests fail on
Linux CI too and not only on a Windows machine:
```js
assert.equal(sh(`resolve_dir /base C:/repos/x`), "C:/repos/x");
```

## NOTES
- A test that pastes a `path.join` temp path into a bash command without quotes has the
  same bug in the test itself. Bash eats the backslashes, so build those paths with
  forward slashes.
- Related: [hook-cwd-is-not-the-commit-target-repo.md](hook-cwd-is-not-the-commit-target-repo.md)
  (why the resolver exists) and bash
  `a-hand-rolled-shell-tokenizer-that-drops-every-backslash-inside-double-quotes.md`.
