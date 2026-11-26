---
tech: rust
tags: [sqlx, sqlx-test, postgres, test-database, concurrency, flaky-tests, worktrees]
severity: medium
---
# Concurrent #[sqlx::test] runs against one Postgres cluster collide on generated test-database names

## PROBLEM
`#[sqlx::test]` creates a throwaway database per test, named from the test path, on the server in `DATABASE_URL`, and drops it afterwards. When two test runs share one Postgres cluster at the same time (several checkouts, worktrees or agents each running the suite), they can generate the same database names and race on create and drop. The failure is in test setup, not in an assertion: `database "..." already exists` or `database "..." does not exist`, and it is intermittent. A single run is reliable, so the problem looks like flakiness in the code under test.

## WRONG
```bash
# Three worktrees, one dev Postgres, same DATABASE_URL, run at once.
(cd wt-a && cargo test) & (cd wt-b && cargo test) & (cd wt-c && cargo test) & wait
# Intermittent: database "_sqlx_test_..." already exists / does not exist
```

## RIGHT
```bash
# Serialise runs that share a cluster (one runner at a time per Postgres)...
flock /tmp/pg-tests.lock cargo nextest run

# ...or give each checkout its own cluster or its own DATABASE_URL host/port,
# and do not diagnose a setup-time "already exists / does not exist" as a code bug.
```

## NOTES
- Observed as an occasional collision; the exact naming scheme was not investigated, so treat the serialising lock as a workaround rather than a proven fix of the cause.
- Re-running the single failing test alone is a quick check: if it passes in isolation the cause is the shared cluster.
- Tell agents working in parallel worktrees which one owns the test database at a time.
