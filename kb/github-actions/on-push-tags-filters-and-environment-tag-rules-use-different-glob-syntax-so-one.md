---
tech: github-actions
tags: [tags, environments, deployment-policy, fnmatch, glob, release]
severity: high
---
# on.push.tags filters and environment tag rules use different glob syntax, so one pattern cannot serve both

## PROBLEM
A workflow `on.push.tags` filter and an environment's deployment tag rule look alike but parse globs differently, and a mismatch silently skips the build or blocks the deploy.
In `on.push.tags`, `.` is literal, `*` matches anything except `/`, and `+` means "one or more of the previous character". Environment deployment branch/tag policies use Ruby `File.fnmatch`, where `+` is a literal character. A pattern like `v*.*.*.*` also needs three dots, so a shorter `v1.2.3` tag never triggers it -- with no error anywhere.

## WRONG
```yaml
on:
  push:
    tags: ['v*.*.*.*']          # a v1.2.3 tag is ignored silently
# environment tag rule copied from the workflow:
#   v[0-9]+.[0-9]+.[0-9]+      # '+' is literal here: matches nothing real
```

## RIGHT
```yaml
on:
  push:
    tags: ['v*.*.*.*', 'v[0-9]+.[0-9]+.[0-9]+']
# environment tag rule: a coarse fnmatch glob
#   v*.*.*
```
Let the workflow filter be the precise gate and keep the environment rule coarse.

## NOTES
After changing either, push a test tag and confirm the run starts and the job's environment step is admitted. List environment rules with `gh api repos/<owner>/<repo>/environments/<env>/deployment-branch-policies`.
