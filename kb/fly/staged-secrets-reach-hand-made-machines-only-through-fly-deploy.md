---
tech: fly
tags: [fly-io, flyctl, secrets, staged-secrets, machines, deploy, volumes]
severity: high
---
# Staged Fly secrets reach hand-made Machines only through `fly deploy`

## PROBLEM
`fly secrets import --stage` sets secrets without deploying them. On an app whose Machines were made by hand with `fly machine create` and never through `fly deploy`, the two obvious ways to apply them do nothing useful:
- `fly machine update --skip-start` updates the Machine but does not apply the staged secrets. `fly secrets list` still marks them Staged (`*`).
- `fly secrets deploy` refuses with "no machines available to deploy". It deploys only to Machines a `fly deploy` release created, and hand-made Machines do not count.

The Machine then starts without the secrets, or with their old values, after a command that returned success.

## WRONG
```bash
fly secrets import --stage -a <app> < secrets.env
fly machine update <machine-id> -a <app> --skip-start   # secrets stay Staged
fly secrets deploy -a <app>                             # "no machines available to deploy"
```

## RIGHT
```bash
fly secrets import --stage -a <app> < secrets.env
# One fly deploy applies the staged secrets; pass any extra settings as -e
fly deploy -c fly.toml -a <app> -e KEY=VALUE
fly secrets list -a <app>        # nothing left marked Staged (*)

# fly deploy may create its own Machine and volume instead of adopting the hand-made ones
fly machine list -a <app>
fly volumes list -a <app>
# Work out which volume holds the data BEFORE destroying anything, then remove the leftovers
fly machine destroy <old-machine-id> -a <app>
fly volumes destroy <old-volume-id> -a <app>
```

## NOTES
- The Machine `fly deploy` creates can come up on a NEW, empty volume. For a database, that is a fresh cluster, not your data, so check before you point anything at it.
- Once the app has a `fly deploy` release, `fly secrets deploy` works, but it leaves stopped Machines stopped. Start them yourself if they are meant to be running.
- From Git Bash, an `-e KEY=/path` value is rewritten into a Windows path before flyctl sees it. See the bash shelf: `git-bash-rewrites-name-equals-slash-args-to-native-exes-use-msys2-arg-conv-excl`.
