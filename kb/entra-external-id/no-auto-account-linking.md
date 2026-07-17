---
tech: entra-external-id
tags: [entra, external-id, ciam, account-linking, google-federation, graph-api, auth0, migration]
severity: high
---
# No automatic account linking by email; same person becomes two accounts

## PROBLEM
In an External ID external tenant, a user who registered with email+password and later
clicks "Sign in with Google" using the SAME email address is NOT linked to their existing
account. The built-in user flows have no email-match linking (confirmed product limitation).
Depending on flow they either get bounced to the password prompt or end up with a second,
separate user object: silent duplicate accounts, split purchase/membership history, and
"the site doesn't know I'm a member" tickets.

## WRONG
```text
Assume Entra will merge identities because the email matches, ship both
"email" and "Google" sign-in, and let users pick whichever button they like.
Result: duplicate user objects per person, discovered months later.
```

## RIGHT
```http
Link identities explicitly via Graph: one user object holds multiple entries in its
identities array. The local (emailAddress) account must be the anchor; add the
federated identity to it. You need the Google subject ID, which you only get when
the user authenticates to Google (build a "link your Google account" action), OR
pre-link during migration:

PATCH https://graph.microsoft.com/v1.0/users/{id}
{
  "identities": [
    { "signInType": "emailAddress", "issuer": "tenant.onmicrosoft.com",
      "issuerAssignedId": "user@example.com" },
    { "signInType": "federated", "issuer": "google.com",
      "issuerAssignedId": "<google-sub>" }
  ]
}
```

## NOTES
Auth0 user exports include each linked identity's provider user_id (the Google `sub`),
so when migrating off Auth0 you can pre-create every user with BOTH identities already
in the array and nobody ever hits the collision. You cannot anchor the other way: a
federated-only account cannot have a local identity added as cleanly; create the local
anchor first. For demos, register email and Google test users with different addresses
so the collision never shows on screen.
