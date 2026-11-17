---
tech: bash
tags: [git-bash, msys, windows, path-conversion, msys2-arg-conv-excl, native-exe]
severity: medium
---
# Git Bash rewrites `NAME=/path` arguments to native .exe CLIs; exclude just those prefixes with MSYS2_ARG_CONV_EXCL

## PROBLEM
Git Bash rewrites an argument to a Windows path before a native .exe sees it when the argument starts with `/`, and also when it has the form `NAME=/value`:
- `fly.exe ... --env WAL_RECOVER_FROM_PATH=/pgbackrest/cluster-1` arrives as `WAL_RECOVER_FROM_PATH=C:/Program Files/Git/pgbackrest/cluster-1`;
- `railway.exe ... --set PGDATA=/var/lib/postgresql/data` arrives as `PGDATA=C:/Program Files/Git/var/lib/postgresql/data`.

The CLI accepts the value and stores it on a remote service, so the damage shows up later as a service using a path that does not exist there.

`MSYS_NO_PATHCONV=1` stops the rewrite, but it also stops the conversion the rest of the script depends on. `node /c/repos/x/script.js` then fails with "Cannot find module", because node.exe receives the unconverted `/c/...` path.

## WRONG
```bash
fly deploy -a <app> -e WAL_RECOVER_FROM_PATH=/pgbackrest/cluster-1   # stored as C:/Program Files/Git/...
export MSYS_NO_PATHCONV=1                                             # fixes that...
node "$PWD/scripts/render.js"                                         # ...and node.exe can't find /c/...
```

## RIGHT
```bash
# Exclude only the arguments that must stay POSIX. Each entry is matched against the
# START of the whole argument, so a NAME=/value argument needs "NAME=", not the path.
export MSYS2_ARG_CONV_EXCL="WAL_RECOVER_FROM_PATH=;WAL_ARCHIVE_PATH=;PGDATA=;/pgbackrest"
fly deploy -a <app> -e WAL_RECOVER_FROM_PATH=/pgbackrest/cluster-1   # arrives unchanged
node "$PWD/scripts/render.js"                                        # /c/... still converted
```

## NOTES
- The prefix rule was checked with node.exe printing its argv. With `MSYS2_ARG_CONV_EXCL="/pgbackrest"` alone, a bare `/pgbackrest/x` argument is left alone, but `WAL_RECOVER_FROM_PATH=/pgbackrest/x` and `--env=/pgbackrest/x` are still converted, because those arguments start with `WAL_...` and `--env=`.
- Verify by reading the value back from the remote side (the platform's variable or config listing), not from your shell. The shell shows what you typed.
- MSYS-compiled tools (`cat`, `grep`) are not affected. Only native Windows programs receive the converted string.
- Related: `msys-path-conversion-corrupts-jq-arg`, `msys-no-pathconv-breaks-jq-file-args`, `git-bash-rewrites-leading-slash-git-sparse-checkout-patterns-into-windows-paths`.
