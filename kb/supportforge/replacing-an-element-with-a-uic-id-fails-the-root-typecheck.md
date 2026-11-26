---
tech: supportforge
tags: [dashboard, uic, typecheck, guard, refactor, check-all]
severity: medium
---
# Replacing a dashboard element that carries a UIC id fails the root typecheck, not the dashboard's

## PROBLEM
Dashboard elements carry ids such as `STFCRD0001` that are listed in
`docs/design-system/UIC_MASTER_LIST.md`. `pnpm run uic:check`
(`scripts/validate-uic.js`) fails when the master list names an id that no
longer appears in the code.

The guard runs only as part of the **root** `pnpm run typecheck`
(`tsc && uic:check && tokens:check`). It is not part of the dashboard's own
`type-check`, `lint` or test run. So a refactor that swaps a card, header or
toolbar for a shared component, dropping the old element and its id, passes
every dashboard check a frontend change normally runs, and then fails
`check:all` and CI's "Design token and UIC guards" step with a list of ids
that looks unrelated to the change:

```
[UIC] IDs in master list but not found in code (13):
 - STFCRD0001
 - STFHDR0001
 ...
```

It is easy to dismiss the master list as stale documentation. It is a gate.

## WRONG
```bash
# After replacing a page's header card with a shared toolbar:
cd dashboard && pnpm run type-check && pnpm run lint && pnpm exec jest settings/staff
# all green -> commit. CI then fails on uic:check.
```

## RIGHT
```bash
# Keep the id on the element that replaces the old one where it is the same thing.
# Where the element is truly gone, prune the list with the repo's own script:
pnpm run uic:prune
rm -f docs/design-system/UIC_MASTER_LIST.md.backup   # the script leaves a backup
pnpm run uic:check                                    # run from the repo root before committing
```

## NOTES
- Deleting dead components trips the same guard: the ids they held are still
  in the master list.
- Pruning is the intended response to a removed element, not a way around the
  check. Do not prune an id whose element still exists under a different id.
- When delegating frontend work, tell the agent to run `pnpm run uic:check`
  from the root; an agent that runs only the dashboard's checks will report
  green.
