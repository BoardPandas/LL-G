---
tech: better-auth
tags: [organization, plugin, tables, drizzle, member, FORBIDDEN]
severity: high
---
# Organization plugin creates its own tables separate from custom schema

## PROBLEM
Better Auth's `organization()` plugin auto-creates `organization` and `member` tables via the Drizzle adapter. If you also define custom `organizations` and `team_members` tables in your schema, you end up with two parallel org systems that share no data. The frontend calls `authClient.organization.create()` which writes to the BA `organization` table, but backend middleware checks the custom `team_members` table where the user doesn't exist -- causing silent FORBIDDEN errors on every authenticated tRPC call.

## WRONG
```typescript
// Schema defines CUSTOM org tables
export const organizations = pgTable("organizations", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  ownerId: uuid().notNull(),
});

export const teamMembers = pgTable("team_members", {
  organizationId: uuid().references(() => organizations.id),
  userId: uuid().references(() => user.id),
  role: teamRoleEnum().notNull(),
});

// Better Auth ALSO creates its own tables:
// "organization" (id text PK, name, slug, logo, metadata, createdAt)
// "member" (id text PK, organization_id, user_id, role text, createdAt)

// Frontend uses BA:
await authClient.organization.create({ name, slug })
// Backend checks custom table:
db.select().from(teamMembers).where(eq(teamMembers.userId, userId))
// Result: user not found -> FORBIDDEN
```

## RIGHT
Pick one system and use it consistently:

**Option A: Use BA tables everywhere**
```typescript
// Switch middleware to read from BA's "member" table
import { member } from "./schema/relations.js"
db.select({ role: member.role }).from(member)
  .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
```

**Option B: Use custom tables, skip BA org plugin**
```typescript
// Frontend calls tRPC instead of BA:
const org = await trpc.org.create.mutate({ name, slug })
// Backend writes to custom tables directly
```

## NOTES
- BA's org plugin uses text IDs, custom tables often use UUID. Foreign keys are incompatible.
- The BA `organization` table has no `ownerId` or `billingEmail` columns.
- If using Option B, the `useActiveOrganization()` and `useListOrganizations()` hooks from BA won't work -- replace with tRPC-based state management.
- Check the migration SQL to see which tables actually exist in the DB.
