---
tech: bash
tags: [git-bash, msys, wsl, variable-expansion, quoting, windows]
severity: high
---
# Git Bash expands $VARS before wsl.exe sees them

## PROBLEM
From Git Bash (msys) on Windows, `wsl.exe -- bash -c "...$HOME..."` expands `$HOME`, `$PATH` and `$?` on the Windows side first. WSL then receives `/c/Users/<name>` or a Windows PATH full of spaces and parentheses. The result is either a syntax error from the parentheses or, worse, a command that silently uses the wrong directory or target dir. Single quotes on the outer command are not a reliable fix, because the harness or the outer shell may re-quote them.

## WRONG
```bash
wsl.exe -d Debian -- bash -c "export CARGO_TARGET_DIR=$HOME/t PATH=$HOME/.cargo/bin:$PATH; cargo test"
```

## RIGHT
```bash
# A quoted heredoc on stdin: nothing is expanded until bash runs inside WSL.
wsl.exe -d Debian -- bash -s <<'EOF2'
export CARGO_TARGET_DIR="$HOME/t" PATH="$HOME/.cargo/bin:/usr/bin:/bin"
cargo test
EOF2
```

## NOTES
wsl.exe output often contains NUL bytes (UTF-16 fragments), so pipe it through `tr -d '\0'` before grepping. `wsl.exe -u root -- ...` runs as root without a sudo password prompt, which helps in non-interactive sessions. Related: ssh-remote-login-shell-fish.md, which covers the same `bash -s` pattern for SSH.
