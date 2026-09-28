---
tech: github-actions
tags: [self-hosted-runner, vitest, tmpdir, runner-temp, quota, edquot, tmpfs, ci]
severity: high
---
# Vitest's temp cache fills a persistent self-hosted runner's /tmp quota and blocks every deploy

## PROBLEM
Vitest 5 writes its SSR transform cache under `os.tmpdir()` on every run (`<tmpdir>/<nanoid>/ssr/`, about 79 MB per coverage run) and never deletes it. Test fixtures made with `mkdtemp` often leak as well. A hosted runner throws all of that away with the VM. A PERSISTENT self-hosted runner keeps it. When that runner's `/tmp` is a tmpfs mounted with `usrquota`, the runner user's quota fills up within days (11 GB in five days in the incident).

Nothing warns you before the quota is hit, and afterwards CI fails on a commit that could not have caused it:
- First, mass vitest collection failures: `ENOENT ... open '/tmp/<nanoid>/ssr/<sha1>'` plus `UNKNOWN: unknown error, write`.
- Then `Unknown system error -122, write` in any step that writes to tmpdir.

errno 122 is EDQUOT. `df -h /tmp` still shows free space because the limit is per user, so check `repquota -s /tmp` instead. Every deploy that `needs:` the verify job is skipped until `/tmp` is swept by hand.

## WRONG
```yaml
jobs:
  verify:
    runs-on: [self-hosted, tcg-host]
    # Does NOT work: the runner context is not available in jobs.<id>.env
    env:
      TMPDIR: ${{ runner.temp }}
    steps:
      - uses: actions/checkout@v4
      - run: pnpm run test:all   # leaves ~79 MB in /tmp every run
```

## RIGHT
```yaml
jobs:
  verify:
    runs-on: [self-hosted, tcg-host]
    steps:
      # FIRST step: every later step (and every vitest run) writes temp files to
      # RUNNER_TEMP, which the runner empties at the start and end of each job.
      - name: Per-job temp directory
        run: echo "TMPDIR=$RUNNER_TEMP" >> "$GITHUB_ENV"
      - uses: actions/checkout@v4
      - run: pnpm run test:all
```

## NOTES
- Verified in BoardPandas/tcg 3.603.1.2. Before the fix, one CI run added 5 cache dirs (about 105 MB) to `/tmp`. After it, a full run left the runner user's `/tmp` usage, cache-dir count and entry count unchanged, and `RUNNER_TEMP` empty.
- `TMPDIR` is the only lever. Vitest reads `os.tmpdir()` and has no config option for the cache location.
- One-time recovery, leaving recent dirs so a running job survives: `sudo find /tmp -mindepth 1 -maxdepth 1 -type d -user <runner-user> -mmin +60 -exec test -d {}/ssr \; -exec rm -rf {} +`.
- Diagnosing it: two re-runs fail in DIFFERENT steps (whichever writes to tmpdir first), which looks like flakiness but is the same quota. See also red-verify-skips-suite-and-deploy.md.
