---
tech: better-auth
tags: [organization, multi-tenant, session, set-active]
severity: high
---
# setActive() requires organization ID, not slug

## PROBLEM
BetterAuth's organization plugin `setActive()` method requires the organization's `id` (UUID), not its `slug`. Using the slug causes silent session context loss — the active organization is not set, and subsequent API calls that filter by `activeOrganizationId` return empty results.

## WRONG
```ts
// Using slug — silently fails, activeOrganizationId is null
await authClient.organization.setActive({ organizationId: "acme-corp" });
```

## RIGHT
```ts
// Using the UUID id — correctly sets session context
await authClient.organization.setActive({ organizationId: "01234567-89ab-cdef-0123-456789abcdef" });
```

## NOTES
- GitHub issue #4708 documents this behavior
- Always use the organization's `id` field, never `slug`, when calling `setActive`
- The `useActiveOrganization()` hook returns the org data after `setActive` succeeds — check it returns non-null to verify
