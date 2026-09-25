---
tech: bash
tags: [bash, ssh, fish, remote]
severity: medium
---
# Commands sent over SSH run in the remote user's login shell, which may be fish

## PROBLEM
`ssh host 'cmd'` runs cmd through the remote account's login shell. When that shell is fish, POSIX syntax fails: `. /etc/os-release` errors with `Unsupported use of '='. In fish, please use 'set NAME "Fedora Linux"'`, and unquoted `{{...}}` (docker --format templates) undergoes brace expansion. Parts of the command that happen to be valid fish still run, so the output looks half-right.

## WRONG
```bash
ssh lancelot '. /etc/os-release; echo $PRETTY_NAME'     # fish syntax error
ssh lancelot docker inspect --format '{{.Name}}' plex      # quotes stripped locally, fish expands braces
```

## RIGHT
```bash
ssh -o BatchMode=yes lancelot 'bash -s' < script.sh
# or a quoted heredoc:
ssh lancelot 'bash -s' <<'SH'
. /etc/os-release; echo "$PRETTY_NAME"
docker inspect --format '{{.Name}}' plex </dev/null
SH
```

## NOTES
Inside a `bash -s` script, give stdin-reading commands `</dev/null` so they do not eat the rest of the script (see docker/compose-exec-stdin-heredoc-drain).
