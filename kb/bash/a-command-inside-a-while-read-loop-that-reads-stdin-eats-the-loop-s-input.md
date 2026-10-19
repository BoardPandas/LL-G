---
tech: bash
tags: [while-read, stdin, file-descriptor, ssh, loop, silent-failure]
severity: high
---
# A command inside a `while read` loop that reads stdin eats the loop's input

## PROBLEM
In `while read -r line; do ...; done <file` (or `producer | while read ...`), the loop's input is also the stdin of every command in its body. A body command that reads stdin takes the rest of the input. The next `read` then hits end of file, and the loop ends after the first line with exit status 0 and no error. A script meant to process six records processes one and reports success.

Commands that read stdin include:
- `ssh` without `-n`, and `ffmpeg` without `-nostdin`
- `docker exec -i` and `kubectl exec -i`
- `psql` or `mysql` without `-c`
- a script that reads `process.stdin` or `sys.stdin`
- a CLI that takes a value from stdin when none is on the command line, such as `wrangler secret put NAME` or `doppler secrets set NAME`

## WRONG
```bash
while IFS= read -r host; do
  ssh "$host" uptime          # reads the rest of hosts.txt, so the loop runs once
done <hosts.txt
```

## RIGHT
Give the loop its own file descriptor, so the body's stdin is untouched:
```bash
while IFS= read -r host <&3; do
  ssh "$host" uptime
done 3<hosts.txt
```
Or keep stdin away from each body command that does not need it: `ssh -n`, `ffmpeg -nostdin`, `cmd </dev/null`. A body command fed by its own pipe (`printf '%s' "$value" | cli set NAME`) is safe, because the pipe replaces its stdin.

## NOTES
- Reproduced in bash 5.3. `while IFS= read -r x; do echo "got $x"; python3 -c 'import sys; sys.stdin.read()'; done <list` over a three-line file printed only `got a`, and the loop's status was 0. With `read -r x <&3` and `done 3<list`, it printed all three.
- `read -u 3` is bash's spelling of `read <&3`. POSIX `sh` needs `<&3`.
- Reading the whole input first also avoids it: `mapfile -t lines <file`, then loop over the array (bash 4 or later, so not macOS's bash 3.2).
- `docker/compose-exec-stdin-heredoc-drain` is the same trap in a script fed to `ssh host bash -s` on a heredoc.
