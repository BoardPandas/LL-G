---
tech: cloudflare
tags: [cloudflare, wrangler, d1, migrations, account-id, multi-account, ci]
severity: high
---
# wrangler d1 migrations ignores account_id under a multi-account login

## PROBLEM
With a login that can see more than one Cloudflare account, `wrangler d1 migrations list <db> --remote` and `wrangler d1 migrations apply <db> --remote` fail non-interactively with "More than one account available but unable to select one", even though `wrangler.jsonc` pins `account_id`. `wrangler d1 info` and `wrangler d1 execute` honour the pinned account in the same repo, so the failure looks like a flaky login rather than a config problem. Observed on wrangler 4.149.

## WRONG
```bash
# wrangler.jsonc pins "account_id": "<id>", but the migrations subcommands still prompt
pnpm exec wrangler d1 migrations apply roundtable_table --remote
# ERROR: More than one account available but unable to select one
```

## RIGHT
```bash
CLOUDFLARE_ACCOUNT_ID="<account-id>" pnpm exec wrangler d1 migrations apply roundtable_table --remote
CLOUDFLARE_ACCOUNT_ID="<account-id>" pnpm exec wrangler d1 migrations list roundtable_table --remote
```

## NOTES
Set `CLOUDFLARE_ACCOUNT_ID` in the CI job environment for every migrations step, so the account is never selected by prompt. Verify with `wrangler d1 migrations list --remote` returning the ledger rather than the account error. A dashboard-side fix is not needed; this is a wrangler selection-path difference.
