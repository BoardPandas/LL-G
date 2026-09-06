---
tech: postgres
tags: [parameters, varchar, case, durable-jobs, mocked-tests, parse-analysis]
severity: high
---
# Reusing a parameter in a VARCHAR assignment and a CASE comparison can reject every completion

## PROBLEM
A durable worker finished its work but the website remained at running. PostgreSQL rejected the terminal update with inconsistent types deduced for parameter $2. The same untyped parameter supplied a VARCHAR state column and a CASE comparison. Query mocks accepted both, so build and unit tests passed while every real result transaction rolled back.

The agent's result-delivery errors were debug-only, so ordinary endpoint logs did not reveal the rejection. Server logs showed immediate completion-report failures after leases were issued. Successful execution and successful result persistence are separate checks.

## WRONG
```sql
UPDATE job_executions
SET state = $2,
    finished_at = CASE WHEN $2 = 'queued' THEN NULL ELSE NOW() END
WHERE id = $1;
```

## RIGHT
```sql
UPDATE job_executions
SET state = $2::varchar,
    finished_at = CASE WHEN $2::varchar = 'queued' THEN NULL ELSE NOW() END
WHERE id = $1;
```

Use one explicit type consistently at each occurrence. Exercise the actual production statement against a real PostgreSQL table with the original VARCHAR column type. Assert that the old query fails with SQLSTATE 42P08, then that the corrected query stores succeeded, failed, cancelled, and queued with the appropriate finished_at value. A fixture using TEXT can conceal the original mismatch.

## NOTES
- TypeScript and mocked query tests cannot run PostgreSQL parse analysis.
- PREPARE can verify inference without executing business mutations. A connection-local temporary table also allows outcome assertions without touching live rows.
- Keep user-visible operation waits bounded and expose the job ID so a rejected completion is diagnosable.
- Observed in SupportForge's service/process manager on 2026-09-06. Related: [constraints narrower than their application types](check-constraint-narrower-than-its-type.md).
