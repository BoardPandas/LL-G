---
tech: vitest
tags: [turborepo, turbo, env, passThroughEnv, integration-tests, skipIf]
severity: high
---
# Turborepo 2 strict env mode strips DATABASE_URL, so skipIf-guarded integration tests skip silently and pass

## PROBLEM
Turborepo 2 runs tasks in strict env mode and drops every environment variable not declared for the task, so integration tests guarded by `describe.skipIf(!process.env.DATABASE_URL)` skip under `turbo run` and the task still succeeds.
The same tests pass when run with `pnpm --filter` directly, and turbo reports "Tasks: 4 successful", so nothing looks wrong unless you read the skipped counts.

## WRONG
```json
{ "tasks": { "test:integration": { "cache": false } } }
```
```bash
doppler run -- pnpm turbo run test:integration   # every DB test: skipped, exit 0
```

## RIGHT
```json
{
  "tasks": {
    "test:integration": {
      "cache": false,
      "passThroughEnv": ["DATABASE_URL", "DATABASE_APP_URL"]
    }
  }
}
```

## NOTES
Use `env` instead of `passThroughEnv` if the variable should change the cache hash. Check the "Tests N passed" line, not just the turbo task summary. A guard that fails when zero integration tests ran would catch this class of silent skip.
