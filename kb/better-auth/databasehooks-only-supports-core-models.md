---
tech: better-auth
tags: [databaseHooks, organization-plugin, member, plugin-tables, silent-failure, hooks]
severity: medium
---
# BetterAuth databaseHooks only supports core models, not plugin tables

## PROBLEM
The top-level `databaseHooks` config on `betterAuth()` only supports the three core models: `user`, `session`, and `account`. Plugin-defined tables (e.g., `member`, `invitation`, `organization` from the organization plugin; `passkey` from the passkey plugin; `twoFactor` from the two-factor plugin) cannot be hooked from `databaseHooks`. The config does NOT error at startup if you specify an unknown model key — it silently ignores it. The hook function never fires and there is no warning. Easy to miss in code review because the syntax looks identical to a working `user` hook.

## WRONG
```ts
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

export const auth = betterAuth({
  plugins: [organization()],
  databaseHooks: {
    member: {
      create: {
        before: async (data) => {
          const count = await countOrgMembers(data.organizationId);
          if (count >= MAX_USERS) {
            throw new Error("Org member cap exceeded");
          }
          return { data };
        },
      },
    },
  },
});
```

## RIGHT
```ts
// Enforce at every API endpoint that calls the plugin API.
// For the organization plugin, that's any route invoking auth.api.createInvitation.

export const POST = withOrgAdmin(async (req, { session, orgId }) => {
  await assertWithinUserLimit(orgId);

  const invitation = await auth.api.createInvitation({
    headers: req.headers,
    body: { email, organizationId: orgId, role: "member" },
  });
});

// Hooks for the supported models still work fine:
export const auth = betterAuth({
  databaseHooks: {
    user: {
      create: {
        before: async (data) => {
          return { data };
        },
      },
    },
  },
});
```

## NOTES
Supported models in `databaseHooks` per the docs: `user`, `session`, `account`. Detection: write the hook, exercise the path, observe the rejection branch is never taken. Audit every API call site that invokes the plugin's API (e.g., `auth.api.createInvitation`, `auth.api.acceptInvitation`) and document any direct DB inserts so future devs know to call the assertion helper explicitly. Related to `org-plugin-tables.md` which covers the dual-table-system trap.
