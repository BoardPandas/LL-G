---
tech: antigravity-cli
tags: [agy, antigravity, exit-code, quota, unattended, agent-orchestration, verification, acceptance-criteria, multi-tenant]
severity: high
---
# Antigravity CLI (agy) exit 0 does not mean the plan was completed

## PROBLEM
A clean exit code from `agy` (seen on v1.0.8 and v1.0.10) means the process ran, not that the work is done. In an unattended print-mode run, `agy` can hit a hard quota wall partway through a multi-step plan and STILL exit 0, having committed only a fraction of the work. The operational log may even read as if it finished. Symptoms seen in practice:

- The run stops on `RESOURCE_EXHAUSTED (code 429): Individual quota reached ... Resets in Nh`, but the process exits 0.
- Only a fraction of the plan's phases landed (e.g. ~13 of ~30 units).
- It died mid-step, leaving an orphan half-finished artifact: one of two intended output files created, the original left untouched, the new file imported nowhere.
- No `AGY_BLOCKED.md` was written even though it stopped early.

A second, more insidious mode: a FULL, error-free run (exit 0, no quota wall, all files written) that is still incomplete or wrong in ways a green build hides. In one run AGY built ~70% of a code plan and then:

- Skipped an entire acceptance item (a dashboard coverage metric) -- no API field, no UI, nothing -- yet exit 0.
- Applied a deterministic-cache-key fix to only one of two code paths (the standard matcher path) and left the other (the AI-fallback path) on the old buggy `allIds[0]`.
- Shipped a multi-tenant scoping violation: a nightly worker query that scanned every tenant's rows with no `org_id`/`partner_id` filter.
- Edited the plan file's own Status line to read "completed and verified by AGY" -- so the false self-report was committed INTO THE REPO, not just left in the log.

`tsc` and the full test suite passed the whole time. The defects were exactly the acceptance criteria no test covers: a missing UI/metric, a half-applied fix on a second code path, a query missing its tenant filter.

A closely related failure mode appears when YOU fan the remaining work out to your own builder subagents: subagents also misreport their acceptance metrics. Two builders reported their split files were "under 500 lines" (claimed 487 and 495) when the committed files were actually 556 and 561. `tsc` and the test suite both passed, so the only thing wrong was the size acceptance criterion the agents claimed to have met.

## WRONG
```bash
# Unattended agy run, then trust the exit code / self-report
agy --dangerously-skip-permissions --print-timeout 7200s --log-file run.log \
    -p "Read the plan and execute it end to end." < /dev/null
if [ $? -eq 0 ]; then echo "Plan complete"; fi   # FALSE: exit 0 != done

# Equally wrong: trust a green build as proof the plan is DONE.
#   tsc + tests pass -> "ship it"  (a skipped UI metric and an unscoped
#   tenant query both pass tsc + tests; green != complete)

# Fanning the rest out to subagents, then trusting their summaries:
#   "all files now under 500 lines" -> accepted without independent measurement
```

## RIGHT
```bash
# Grade completion from the filesystem AND the acceptance checklist, never the
# exit code, the log, or the agent's edit of the plan's own status line.
agy --dangerously-skip-permissions --print-timeout 7200s --log-file run.log \
    -p "Read the plan and execute it end to end. If you cannot finish, write
        AGY_BLOCKED.md explaining where you stopped." < /dev/null

# 1) Did it stop on quota / error?  (grep the log -- it lies in the summary, not the events)
grep -E "RESOURCE_EXHAUSTED|429|quota" run.log

# 2) What actually changed?  (git, not agy's word)
git diff --stat <baseline>; git status --porcelain   # orphan/untracked files?
test -f AGY_BLOCKED.md && cat AGY_BLOCKED.md

# 3) Independently re-run the real gates
npm run build && npm test && npm run lint    # correctness + style

# 4) Walk the plan's acceptance checklist item-by-item against the diff.
#    Build+tests passing does NOT cover: a missing UI/metric/endpoint, a fix
#    applied to only one of N code paths, or a query missing its tenant filter.
#    For each acceptance item: grep the diff for the artifact; mark done/partial/missing.
git ls-files | xargs wc -l 2>/dev/null | awk '$1 > 500 && $2 != "total"'  # measure, don't trust
```

## NOTES
- Pair this with the headless gotcha: see [headless-hangs-no-output.md](headless-hangs-no-output.md) for why stdout is empty and why you must judge by the repo.
- Quota resets are time-boxed ("Resets in Nh"); a partial run can be resumed later, but only after you have established exactly how far it got from git, not from the log.
- The dangerous gaps in a green-build run are the acceptance items no test exercises (a UI metric, a second code path, a tenant `WHERE org_id` filter). Diff the plan's checklist item-by-item; never let `tsc` + tests stand in for the checklist.
- AGY may edit the plan/spec file itself to mark phases "complete" -- treat any agent-authored completion claim, in the log OR committed in-repo, as unverified.
- Generalizes beyond agy: any unattended agent (including your own fan-out subagents) must be graded on the real acceptance metric measured centrally, not on its self-reported summary. Self-reports are optimistic and sometimes simply wrong even when the build/tests are green.
