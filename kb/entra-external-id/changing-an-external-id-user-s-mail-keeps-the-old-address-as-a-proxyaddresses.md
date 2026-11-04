---
tech: entra-external-id
tags: [ciam, graph, proxyaddresses, email-change, identities]
severity: medium
---
# Changing an External ID user's mail keeps the old address as a proxyAddresses alias that Graph cannot remove

## PROBLEM
PATCHing a customer user's `mail` (and its email one-time-passcode identity) in an external tenant leaves the old address in `proxyAddresses` as a secondary `smtp:` alias, and Graph refuses to edit `proxyAddresses`.
The PATCH returns 204 and the sign-in identity moves cleanly, so it looks complete. But the old address still appears on the object, and because proxy addresses are unique in the directory, a new sign-up on that old address can collide with it. Anyone asked to "remove this email from the system" should know it cannot be fully scrubbed this way.

## WRONG
```http
PATCH /users/{id}
{ "mail": "new@example.com",
  "identities": [ { "signInType": "federated", "issuer": "mail", "issuerAssignedId": "new@example.com" },
                  { "signInType": "userPrincipalName", "issuer": "<tenant>.onmicrosoft.com", "issuerAssignedId": "{id}@<tenant>.onmicrosoft.com" } ] }
```
Then assuming the old address is gone.

## RIGHT
```http
GET /users/{id}?$select=mail,proxyAddresses,identities
```
Expect `proxyAddresses: ["smtp:old@example.com", "SMTP:new@example.com"]`. Report the leftover alias; the only way to clear it is to delete and recreate the user, which loses its object id and anything keyed on it.

## NOTES
Keep the identities shape the tenant already uses (email OTP is `federated` / issuer `mail`); send the whole `identities` collection, including the userPrincipalName entry. Writing `identities` needs User.ManageIdentities.All. Related: graph-api/proxyaddresses-readonly, graph-api/read-after-write-lag (the first by-id read after the PATCH may still show the old values).
