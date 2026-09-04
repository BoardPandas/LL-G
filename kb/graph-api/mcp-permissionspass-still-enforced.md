---
tech: graph-api
tags: [mcp, permissionspass, admin-consent, app-registration, privilege-escalation, stale-docs]
severity: high
---
# A retired doc pattern does not retire the API parameter it described (`permissionsPass`)

## PROBLEM

Privileged Graph writes through an MCP wrapper (app-registration edits,
`appRoleAssignments`, `oauth2PermissionGrants`, directory-role membership) can sit
behind **two independent controls**:

1. a **capability** on the calling user (e.g. `mcp.graph.privileged`) -- standing,
   admin-granted; and
2. a **`permissionsPass` argument** on the request itself -- per-call, supplied by a
   human at the time of the change.

When the *repo-side documentation* describing where that pass value came from is
retired, agents read the changelog, see "the permissions pass gate was removed", and
conclude the **parameter** is dead. It is not. Deleting the doc that told you where to
find a secret does not delete the code that validates it.

The failure is confident and expensive: the agent refuses a legitimate, already-authorized
change, tells the user the pass "can't unlock this gate anymore", and sends them off to
toggle a capability **they already hold**. Nothing errors. The work just stops, and the
user is now debugging a non-problem.

Two details make this especially easy to get wrong:

- **`permissionsPass` does not appear in the capability listing** (`supportforge_my_access`
  and equivalents). It is a second factor checked inside the request handler, not a
  capability, so an agent auditing its own grants sees no trace of it and reasonably
  infers it isn't real.
- **It is not either/or.** The capability *and* the pass are both required. An agent that
  frames it as "I need a capability toggle, not a password" is wrong twice.

This exact mistake has now been recorded twice against the same system: once when an
internal brief called the parameter "possibly vestigial" (corrected in writing), and again
weeks later by a fresh agent session that had access to that correction and did not read it.

## WRONG

```text
# Agent reasoning after reading a changelog entry
"Your team removed 'the PFX password is the permissions pass' from the docs on
 2026-09-02, specifically because that control moved to the MCP. The certificate
 password still works for its real job, but it can't unlock this particular gate
 anymore. I need something different from you: a capability toggle, not a password."

=> Refuses an authorized change.
=> Sends the user to grant a capability the account already holds.
=> Never retries with the parameter the server explicitly asked for.
```

```jsonc
// The call it gave up on -- missing the one argument the error named
{
  "tool": "graph_request",
  "tenant": "<tenantId>",
  "method": "POST",
  "path": "/oauth2PermissionGrants",
  "body": { "clientId": "...", "consentType": "AllPrincipals",
            "resourceId": "...", "scope": "openid profile email" }
}
```

## RIGHT

```text
# Read the rejection literally. It names the missing argument.
Error: Permission change on tenant "<Tenant>" requires authorisation.
Requested: POST /oauth2PermissionGrants. This can grant Graph permissions or
admin consent, so it needs the permissionsPass argument as well as the
mcp.graph.write capability.
                              ^^^^^^^^^^^^^^ -- an argument, not a capability

# So: ask the human for the pass, then retry the identical call with it.
```

```jsonc
// Same call, plus the second factor -> HTTP 201
{
  "tool": "graph_request",
  "tenant": "<tenantId>",
  "method": "POST",
  "path": "/oauth2PermissionGrants",
  "permissionsPass": "<ask the user; never guess, cache, or write it to a file>",
  "body": { "clientId": "...", "consentType": "AllPrincipals",
            "resourceId": "...", "scope": "openid profile email" }
}
```

Before declaring any gate dead, verify empirically rather than from a changelog:

```text
1. Check capabilities           -> supportforge_my_access (or equivalent)
2. Send the privileged call WITHOUT the pass
3. Read the error text verbatim -- does it name an argument or a capability?
4. If it names an argument: ask the user for it and retry
```

## NOTES

**The generalizable rule:** a changelog entry that removes *documentation* about a
credential is not evidence that the *enforcement* was removed. Documentation and
enforcement live in different repositories and are retired on different schedules. The
authority on whether a gate is live is the server's own error response, not a doc. One
rejected call settles it in seconds; guessing from a changelog produces a confident wrong
answer that costs the user a support round-trip.

**Server-side shape** (for the case that prompted this entry): the pass is compared with
`timingSafeEqual` against a `GRAPH_PERMISSIONS_PASS` environment variable, additionally
requires the privileged capability, and **fails closed** when the env var is unset.

**Not everything dangerous is gated**, so do not read "the pass was not requested" as "this
call is safe". Known uncovered paths on the same wrapper: `/policies/*` writes
(`claimsMappingPolicies`, `tokenIssuancePolicies`, `permissionGrantPolicies`,
`appManagementPolicies`, `authenticationMethodsPolicy`) run under an ordinary write
capability with no pass check -- and a claims-mapping policy determines what lands in
issued tokens, so it can influence a downstream app's authorization decisions without
touching a single Graph permission or directory role. Treat those as privileged by hand.

**A standing capability is not a per-change approval.** Where a per-call pass forced a human
handover every single time, a capability grant persists, so nothing stops a second or tenth
escalation. Showing the user the exact change and getting an explicit yes becomes convention
rather than enforcement -- which makes the habit more important, not less.

Related: [403 = missing admin consent, not missing permission](403-admin-consent.md) --
declaring a permission in `requiredResourceAccess` and granting it are two separate calls,
and both are privileged. [New permissions take 1-15 min to propagate](permission-propagation.md)
-- do not read an immediate post-grant 403 as a failed grant.
