---
tech: bash
tags: [ssh, grep, stdin, pipe, secret-scan, false-green, patterns, grep-f]
severity: high
---
# `ssh host 'cmd | grep -f -'` reads the patterns from the pipe, not from ssh's stdin

## PROBLEM
To check a remote host for leaked secrets without putting the secrets on a command line, it is tempting to send them as grep patterns on standard input:

```bash
printf '%s\n' "$secret" | ssh host 'journalctl -u app | grep -F -f -'
```

Inside the remote pipeline, grep's standard input is the **pipe from `journalctl`**, not ssh's stdin. `-f -` therefore reads the log text as the pattern list and consumes it; there is then nothing left to search. grep prints nothing and exits 1, which a secret scan reads as "no secrets found". The scan is green whatever the logs contain.

## WRONG
```bash
printf '%s\n' "$secret" | ssh host 'journalctl -u app | grep -F -f -'
# prints nothing, exit 1 -> reported as clean, always
```

## RIGHT
```bash
# Hand the outer stdin to grep on a separate descriptor, and include a control
# pattern that MUST match, so "no output" can never mean "scan did not run".
printf '%s\n' "$secret" 'SCAN-CONTROL-LINE' | ssh host 'bash -c "
  { { journalctl -u app; echo SCAN-CONTROL-LINE; } | grep -F -c -f /dev/fd/3; } 3<&0
"'
# Expect exactly 1 (the control line). 0 means the scan is broken; more than 1 means a leak.
```

## NOTES
- Verified locally: with patterns on the outer stdin, `cmd | grep -F -f -` prints nothing and exits 1; with `3<&0` and `-f /dev/fd/3` the same input matches.
- Any negative check ("assert this never appears") needs a positive control. Without one, a broken scan and a clean result look the same.
- The remote login shell may not be bash; see `ssh-remote-login-shell-fish.md` on this shelf.
