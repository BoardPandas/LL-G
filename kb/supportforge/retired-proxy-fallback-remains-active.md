---
tech: supportforge
tags: [nextjs, railway, migration, proxy, environment, defaults, verification]
severity: medium
---
# A retired proxy fallback stays active when deployment omits its variable

## PROBLEM

One dashboard proxy retained a hostname from the previous hosting platform as
its `API_URL` fallback. Production omitted that variable. Other proxies used the
current public API fallback, so normal dashboard traffic worked while generic
installer metadata and retired download refusals returned 500 through the public
proxy. Direct API probes were healthy. Tests that mock fetch without asserting
the destination cannot detect the unreachable default.

## WRONG

```typescript
const API_URL = process.env.API_URL || 'http://retired-internal-api:3002';
// fetch is mocked to succeed regardless of URL in tests.
```

## RIGHT

```typescript
const API_URL = process.env.API_URL || 'https://api.supportforge.ai';
// Test the absent-variable path, assert the actual target URL, and preserve
// public metadata, refusal statuses and package-format query parameters.
```

## NOTES

Compare live requests through both API and dashboard hosts. Verify variable
presence without dumping credentials. Connected Railway OAuth tools expose
variable names with redacted values: an absent name establishes absence, while a
redacted value does not. In this case the API returned 410 and dashboard 500;
Railway confirmed the variable name was absent, activating the stale fallback.

Keep public installer routes usable before device enrollment; do not replace a
routing repair with device authentication on the generic binary. Existing
explicit API_URL overrides remain supported.

SupportForge's broad `public` gitignore rule also matches route-adjacent tests
under `app/api/v1/public/__tests__`. Put these regressions in the tracked shared
API test directory and inspect the staged diff before committing.

This is runtime proxy configuration and test tracking, not agent configuration;
no Claude/Codex configuration eval is needed.
