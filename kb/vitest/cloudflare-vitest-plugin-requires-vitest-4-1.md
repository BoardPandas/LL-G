---
tech: vitest
tags: [cloudflare, workers, vitest, miniflare]
severity: medium
---
# @cloudflare/vitest-plugin needs Vitest ^4.1, not the latest major

## PROBLEM
Scaffolding with `vitest@latest` pulls Vitest 5, which @cloudflare/vitest-plugin does not support yet; the worker test project fails to start. The package was also renamed, so old docs reference vitest-pool-workers.

## WRONG
```json
"vitest": "latest", "@cloudflare/vitest-plugin": "latest"
```

## RIGHT
```json
"vitest": "^4.1", "@cloudflare/vitest-plugin": "latest"
```
