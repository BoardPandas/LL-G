---
tech: better-auth
tags: [two-factor, twoFactor, schema-drift, failedVerificationCount, lockedUntil, drizzle-adapter, migration, version-upgrade]
severity: high
---
# Minor better-auth upgrades silently add REQUIRED plugin columns (2FA lockout)

## PROBLEM
A patch/minor better-auth bump can add new fields to a plugin's table schema that the
Drizzle adapter then references on EVERY read/write of that table. If you hand-maintain the
Drizzle schema (as most apps do, so the relational query builder can JOIN), the new column
is missing from BOTH your schema object and the DB, and the adapter throws
`The field "<name>" does not exist in the "<table>" Drizzle schema. Please update your
drizzle schema or re-generate...` — surfacing as an opaque 500 with an EMPTY body (Next.js
swallows the thrown APIError). Nothing lands in your app logger because the throw is inside
better-auth's handler, not your route.

Concretely, better-auth 1.6.x's two-factor plugin added `failedVerificationCount` (number,
default 0) and `lockedUntil` (date, nullable) to the `twoFactor` table for TOTP verify
lockout. `/two-factor/enable` and `/two-factor/verify-totp` 500 for EVERY user — but only
users enrolling AFTER the upgrade. Rows created before the bump still exist and read fine
until touched, so "it works for some users" masks the regression (in our case 2 pre-upgrade
enrollments succeeded; every new one failed). Vigilis hit this 2026-07-17.

## WRONG
```typescript
// schema/auth.ts — mirrors an OLDER better-auth twoFactor shape
export const twoFactor = pgTable("twoFactor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backupCodes").notNull(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  verified: boolean("verified").default(true),
  // MISSING: failedVerificationCount, lockedUntil — added by the plugin on upgrade.
});
// → adapter.create/find on twoFactor throws "field does not exist", 500 empty body.
```

## RIGHT
```typescript
// After any better-auth upgrade, diff the plugin's schema.mjs against your Drizzle tables:
//   node_modules/better-auth/dist/plugins/two-factor/schema.mjs
export const twoFactor = pgTable("twoFactor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backupCodes").notNull(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  verified: boolean("verified").default(true),
  failedVerificationCount: integer("failedVerificationCount").default(0), // added 1.6.x
  lockedUntil: timestamp("lockedUntil", { withTimezone: true }),           // added 1.6.x
});
// then: pnpm db:generate → ALTER TABLE ADD COLUMN (non-destructive) → apply.
```

## NOTES
- The authoritative source of a plugin's expected columns is its `dist/plugins/<name>/schema.mjs`
  (fields with `input:false` are adapter-managed and still must exist as columns). Diff it on
  every better-auth version bump — the changelog does not always call these out.
- The error text names the field explicitly; grep it. But the 500 body is empty and it does
  NOT reach your logger — reproduce by calling `auth.api.enableTwoFactor({ headers, body })`
  in a script against the real DB, which surfaces the actual thrown message.
- Two-headed gotcha on verification: the DB migration fixes the column, but the deployed app
  still throws until the CODE (schema object) redeploys — the adapter validates against the
  in-process Drizzle schema, not the DB. Ship the schema change, don't just ALTER the table.
- Don't trust a version-number health poll to confirm the fix is live when multiple CI/agents
  push concurrently (version bumps collide); poll the ENDPOINT BEHAVIOR (500 → 200) instead.
