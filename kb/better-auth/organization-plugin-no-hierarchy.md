---
tech: better-auth
severity: HIGH
applies-to: [better-auth, multi-tenant-saas, hierarchical-tenancy]
---
# BetterAuth organization plugin doesn't model hierarchical tenancy

## SYMPTOM
You need three or more levels of tenancy (e.g., broker -> org -> user, or workspace -> team -> user) and try to model the upper layer (broker/workspace) by nesting orgs inside orgs, or by adding a `parent_organization_id` column.

You spend hours fighting:
- The plugin's `member` table only links users to one org level
- `setActive(organizationId)` only takes one org at a time
- Cross-org queries silently return empty
- Permission checks don't compose across levels
- Your custom `parent_org_id` column is ignored by all plugin hooks

## CAUSE
BetterAuth's `organization()` plugin is designed for **single-level org membership** (one user -> many orgs, one org -> many users). It does not model hierarchical relationships between orgs and provides no hooks to extend membership across additional levels.

The plugin's auto-created tables (`organization`, `member`, `invitation`, `team`) are flat. Adding columns like `parent_organization_id` works at the schema level but the plugin's role/permission/active-org logic never consults them.

## FIX
Build the upper-tier tenancy as a **parallel system**, not a nested org:

1. **Separate entity table**: `partners` / `workspaces` / `tenants` with own ID and metadata.
2. **Separate membership table**: `partner_memberships(user_id, partner_id, role)` independent of BetterAuth's `member` table. Use your own role enum.
3. **Foreign-key down**: `organization.partner_id` links each BetterAuth org to its parent.
4. **Custom guards**: write your own `withPartnerAdmin(partnerId)`, `withPartnerScope(...)` middleware that checks the membership table directly. Do not try to extend BetterAuth's permission system.
5. **Compose with org plugin**: BetterAuth's org plugin still handles user <-> org membership at the leaf level. Your partner layer sits on top of it.

Example schema (Drizzle):

```ts
// Your custom partner layer
partners: { id, name, status, ... }
partner_memberships: { id, partnerId, userId, role: 'partner_admin' | 'partner_member' | 'partner_readonly' }

// BetterAuth-managed (touches its own tables)
organization: { id, name, partnerId, ... }  // partnerId is YOUR addition
member: { id, organizationId, userId, role }  // BA owns this

// Your guards check both:
function withPartnerScope(partnerId, requiredRole) {
  // 1. Look up partner_memberships row directly
  // 2. Compose with BetterAuth org checks for nested operations
}
```

## DETECTION
- You're trying to express "user X is admin of broker Y, which contains orgs Z1, Z2, Z3" with BetterAuth alone
- You have a `parent_organization_id` or `super_organization_id` column on `organization`
- You're calling `setActive` repeatedly to walk an org hierarchy
- Permission checks return wrong answers when traversing multiple org levels

## RELATED
- See: "Organization plugin creates separate tables from custom schema" -- BA owns its tables, do not fight it
- BetterAuth admin plugin works at user/role level, not tenant hierarchy
- Composite indexes `(parent_id, leaf_id, created_at DESC)` on tenant-scoped tables matter for query plans at 50+ partners
