---
tech: bash
tags: [git-bash, msys, windows, cygpath, paths, hooks]
severity: high
---
# Git Bash spells one directory several ways, so path compares silently never match

## PROBLEM
Under Git Bash, the same directory comes back as `/tmp/x`, `/c/x`, `C:/x` or `C:\x` depending on who answers, so a prefix or containment check between two sources never matches and raises no error.
`pwd -P` answers `/tmp/x` (Temp is mounted at `/tmp`) or `/c/x`; `readlink -f 'C:\x\a.go'` answers `C:/x/a.go`; `git rev-parse --show-toplevel` answers `C:/x`; Claude Code hook payloads (`cwd`, `file_path`, `transcript_path`) carry `C:\x\...`; `$HOME` is `/c/Users/me`. Effects seen: a format-on-edit hook skipped every file on Windows, a SessionStart hook never detected its client, and a commit gate read `cd C:/repos/x` as relative, resolved nothing, and allowed the commit unchecked. Tests break too: a Node `join()` path interpolated unquoted into a shell command (`cd C:\Users\x`) is read by bash as `C:Usersx`.

## WRONG
```bash
ROOT=$(cd "$(git rev-parse --show-toplevel)" && pwd -P)   # /tmp/x/repo
FILE=$(readlink -f "$FILE_PATH")                          # C:/Users/me/AppData/Local/Temp/x/repo/a.go
case "$FILE" in "$ROOT"/*) format "$FILE" ;; esac         # never matches

case "$dir" in /*) abs=$dir ;; *) abs=$base/$dir ;; esac  # C:/repos/x treated as relative
```

## RIGHT
```bash
# Identity off Windows; one spelling on Git Bash / Cygwin.
canon_path() { cygpath -m -- "$1" 2>/dev/null || printf '%s' "$1"; }
ROOT=$(canon_path "$ROOT"); FILE=$(canon_path "$FILE")

case "$dir" in
  /*) abs=$dir ;;
  [A-Za-z]:[/\\]*)
    case "${OSTYPE:-}" in msys*|cygwin*) abs=$dir ;; *) abs=$base/$dir ;; esac ;;
  *) abs=$base/$dir ;;
esac
```
```js
// Tests: pass paths into shell commands the way Git Bash spells them.
const shellPath = (p) => (process.platform === "win32" ? p.replaceAll("\\", "/") : p);
```

## NOTES
Use `cygpath -m` (C:/...), not `-u`: native tools such as jq, gofmt and git accept it even with `MSYS_NO_PATHCONV=1` (see `msys-no-pathconv-breaks-jq-file-args`). Some Git Bash builds report `OSTYPE=cygwin`, not `msys`, so match both. Inside double quotes, bash keeps a backslash unless it precedes `$`, a backtick, `"`, `\` or a newline, so a command tokenizer must not drop it.
