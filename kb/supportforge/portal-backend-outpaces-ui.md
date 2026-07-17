---
tech: supportforge
tags: [portal, reports, scoping, api-audit, ui, planning]
severity: medium
---
# Portal backend outpaces its UI — audit route payloads before scoping "missing" reports as backend work

## PROBLEM
The SupportForge customer portal's backend routinely returns more data than the UI renders. When comparing the portal against a reference (e.g. a legacy portal) it is easy to classify a missing report as "needs new endpoint/sync/migration" when the data is already in the existing endpoint's JSON — the page just never renders it. During the July 2026 report-parity project, an entire planned phase of "missing" reports turned out to be returned-but-unrendered: the reports weekday×hour heatmap, p90 response/resolution stats, ticket source mix, invoice search/sort/pagination and line-item detail, security alert filters/pagination, asset hardware fields (os/serial/model/IP/firmware), and M365 secure-score category scores. Scoping them as backend work would have produced duplicate endpoints and wasted migrations.

## WRONG
```text
1. Open the portal page, see the report is missing.
2. Conclude the platform doesn't have the data.
3. Plan a new endpoint + cache table + sync job for it.
```

## RIGHT
```text
1. Open the portal page, see the report is missing.
2. Read the matching src/routes/customer-portal-*.ts route AND the service
   it calls (e.g. src/services/client-reports.ts) — inspect the full JSON
   payload it already returns, including query params it already accepts
   (search/filters/pagination are often implemented server-side only).
3. Only scope backend work for fields genuinely absent from the payload.
```

## NOTES
Confirmed during tasks/portal-report-parity-implementation-plan.md: Phase 1 shipped ~2× report surface as UI-only changes with zero migrations. Related smell: don't trust module-header comments over code — cron-jobs-portal.ts claimed its vendor fetchers were "stubs" long after all seven were real implementations.
