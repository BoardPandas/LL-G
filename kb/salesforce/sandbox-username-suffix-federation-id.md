---
tech: salesforce
tags: [salesforce, saml, sso, sandbox, federation-id, username, name-id, subject-mapping]
severity: high
---
# Sandbox username suffix breaks SAML username matching; use Federation ID

## PROBLEM
SAML SSO with "SAML Identity Type = Assertion contains the User's Salesforce
username" fails in a sandbox because Salesforce appends `.<sandboxname>` to EVERY
username on refresh/creation. The IdP sends `chief@dept.gov`, but the sandbox username
is `chief@dept.gov.iafcfull`, so they never match. The Assertion Validator reports
"Unable to map the subject to a Salesforce user" with every SAML check green, which
looks like a config error when it is really a value-mismatch.

## WRONG
```text
SSO setting: SAML Identity Type = "...the User's Salesforce username"
IdP Name ID: user's email (chief@dept.gov)
Sandbox user's Username: chief@dept.gov.iafcfull  (forced .iafcfull suffix)
-> Assertion Validator: "Unable to map the subject to a Salesforce user"
```

## RIGHT
```text
SSO setting: SAML Identity Type = "Assertion contains the Federation ID from the
             User object"
User record: Federation ID = <exact Name ID value the IdP sends>
             (free-text field, NO sandbox suffix mangling)

At scale, don't stamp Federation ID by hand: populate it during member data
migration, or use JIT provisioning (custom Apex SamlJitHandler for community users)
which stamps FederationIdentifier on user creation.
```

## NOTES
- The SAML Assertion Validator (on the SSO setting) shows the exact Subject value the
  IdP sent; copy it verbatim into the Federation ID field to guarantee a match.
- In PRODUCTION there is no sandbox suffix, so username=email matching works natively;
  the Federation ID workaround is primarily a sandbox concern, but Federation ID is
  more robust anyway (survives email changes).
- Entra External ID members' default Name ID is `<objectid>@tenant.onmicrosoft.com`
  (a GUID UPN), not their email. Send `user.mail` as Name ID for a readable key, and
  confirm `mail` is populated (self-service members sometimes only have it in the
  identities collection).
