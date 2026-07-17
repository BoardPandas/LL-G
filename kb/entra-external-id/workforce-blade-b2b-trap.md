---
tech: entra-external-id
tags: [entra, external-id, ciam, b2b, workforce-tenant, identity-providers, google-federation]
severity: high
---
# Workforce-tenant External Identities blade is a CIAM lookalike trap

## PROBLEM
When setting up Entra External ID (CIAM) for customer/member sign-in, the workforce tenant's
External Identities > All identity providers blade looks exactly like the external tenant's,
and it shows "Microsoft Entra ID / Email one-time passcode / Microsoft" as Configured by
default in EVERY tenant, which reads as "someone already started setting this up." It didn't.
Those are the default B2B guest-redemption settings. Configuring Google there does NOT add
customer Google sign-in; it lets anyone with a Gmail account redeem B2B guest invitations
into the client's PRODUCTION workforce directory, a real security-posture change made on the
wrong tenant while looking for something else.

## WRONG
```text
1. Sign in to entra.microsoft.com in the client's workforce tenant (top-right shows CLIENT.ORG)
2. External Identities > All identity providers > Google > Configure
3. Paste Google OAuth client ID/secret
Result: Gmail users can now redeem guest invites into the production directory.
No customer-facing sign-in was created.
```

## RIGHT
```text
1. Create/switch to the EXTERNAL tenant first:
   Entra ID > Overview > Manage tenants > Create > External (30-day trial needs no
   Azure subscription; requires Tenant Creator role)
2. Verify tenant context before touching identity providers: the top-right account
   badge must show the external tenant (e.g. clientmembers.onmicrosoft.com), never
   the client's production domain.
3. Configure Google inside the external tenant, then attach it to the user flow:
   External Identities > User flows > (flow) > Identity providers > check Google.
```

## NOTES
The workforce and external tenant admin UIs are nearly identical blade-for-blade; the
tenant badge in the top-right corner is the only reliable tell. A new IdP attached to a
user flow only appears on the sign-in page after it is checked under the user flow's
Identity providers settings, and pages cache, so test in a fresh private window.
