---
tech: bash
tags: [bash, heredoc, redirection, stdin, ssh, docker, silent-failure]
severity: high
---
# A `</dev/null` after a heredoc on the same command silently replaces it

## PROBLEM
Redirections on one command apply left to right, and the last one for a file descriptor wins. In `ssh host 'bash -s' <<'EOF' ... EOF </dev/null`, stdin becomes the heredoc and then `/dev/null`, so the remote `bash -s` reads an empty script: it runs nothing, prints nothing, and exits 0. That looks exactly like a script whose commands had nothing to report. `docker exec -i box python - <<'PY' ... PY </dev/null` fails the same way.

The `</dev/null` comes from a sound instinct: in a script fed through stdin, any inner command that reads stdin (`docker compose`, `docker logs`, `ssh`, `read`) swallows the rest of the script unless its own stdin is redirected. The redirect belongs on those inner commands, not on the command that receives the heredoc.

## WRONG
```bash
ssh host 'bash -s' <<'EOF' </dev/null
docker ps
docker compose up -d
EOF
```

## RIGHT
```bash
ssh host 'bash -s' <<'EOF'
docker ps </dev/null
docker compose up -d </dev/null
EOF
```

## NOTES
- Verified on GNU bash 5.3.9: `cat <<EOF </dev/null` prints nothing and exits 0; `cat </dev/null <<EOF` prints the heredoc.
- Writing this entry with a shell heredoc hit a second trap: the example's own `EOF` line ends the outer `<<'EOF'` early, and the rest of the text runs as commands. Write text that contains a heredoc with a file-writing tool, or give the outer heredoc a delimiter the text never uses (`<<'ENTRY'`).
- Related: [ssh-remote-login-shell-fish.md](ssh-remote-login-shell-fish.md), the reason to send a script to `bash -s` at all.
