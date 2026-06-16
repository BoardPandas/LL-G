---
tech: antigravity-cli
tags: [agy, antigravity, exit-code, quota, unattended, agent-orchestration, verification]
severity: high
---
# Antigravity CLI (agy) exit 0 does not mean the plan was completed

## PROBLEM
A clean exit code from `agy` (v1.0.8) means the process ran, not that the work is done. In an unattended print-mode run, `agy` can hit a hard quota wall partway through a multi-step plan and STILL exit 0, having committed only a fraction of the work. The operational log may even read as if it finished. Symptoms seen in practice:

- The run stops on `RESOURCE_EXHAUSTED (code 429): Individual quota reached ... Resets in Nh`, but the process exits 0.
- Only a fraction of the plan's phases landed (e.g. ~13 of ~30 units).
- It died mid-step, leaving an orphan half-finished artifact: one of two intended output files created, the original left untouched, the new file imported nowhere.
- No `AGY_BLOCKED.md` was written even though it stopped early.

Trusting the exit code (or agy's own log self-report) here ships a silently-incomplete change that looks successful.

A closely related failure mode appears when YOU fan the remaining work out to your own builder subagents: subagents also misreport their acceptance metrics. Two builders reported their split files were "under 500 lines" (claimed 487 and 495) when the committed files were actually 556 and 561. `tsc` and the test suite both passed, so the only thing wrong was the size acceptance criterion the agents claimed to have met.

## WRONG
```bash
# Unattended agy run, then trust the exit code / self-report
agy --dangerously-skip-permissions --print-timeout 7200s --log-file run.log \
    -p "Read the plan and execute it end to end." < /dev/null
if [ $? -eq 0 ]; then echo "Plan complete"; fi   # FALSE: exit 0 != done

# Fanning the rest out to subagents, then trusting their summaries:
#   "all files now under 500 lines" -> accepted without independent measurement
```

## RIGHT
```bash
# Grade completion from the filesystem, never the exit code or the log.
agy --dangerously-skip-permissions --print-timeout 7200s --log-file run.log \
    -p "Read the plan and execute it end to end. If you cannot finish, write
        AGY_BLOCKED.md explaining where you stopped." < /dev/null

# 1) Did it stop on quota / error?  (grep the log -- it lies in the summary, not the events)
grep -E "RESOURCE_EXHAUSTED|429|quota" run.log

# 2) What actually changed?  (git, not agy's word)
git log --oneline <baseline>..HEAD
git status --porcelain          # orphan/untracked half-finished files?
test -f AGY_BLOCKED.md && cat AGY_BLOCKED.md

# 3) Independently re-run the real gates
npm run build && npm test       # correctness
# 4) Independently measure the ACTUAL acceptance criterion -- do not accept agent claims
git ls-files | xargs wc -l 2>/dev/null | awk '$1 > 500 && $2 != "total"'
```

## NOTES
- Pair this with the headless gotcha: see [headless-hangs-no-output.md](headless-hangs-no-output.md) for why stdout is empty and why you must judge by the repo.
- Quota resets are time-boxed ("Resets in Nh"); a partial run can be resumed later, but only after you have established exactly how far it got from git, not from the log.
- Generalizes beyond agy: any unattended agent (including your own fan-out subagents) must be graded on the real acceptance metric measured centrally, not on its self-reported summary. Self-reports are optimistic and sometimes simply wrong even when the build/tests are green.
