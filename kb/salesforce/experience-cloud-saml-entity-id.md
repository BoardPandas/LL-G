---
tech: salesforce
tags: [salesforce, experience-cloud, saml, sso, entity-id, entra, azure-ad, aadsts700016, aadsts50011]
severity: high
---
# Experience Cloud SAML: SP entity ID is the org, ACS is per-site

## PROBLEM
When federating a Salesforce Experience Cloud (community) site to an external SAML IdP
(Entra, Okta, etc.), the SP entity ID and the ACS come from DIFFERENT scopes.
Experience Cloud sends the **org My Domain** as the SP entity ID (issuer), but a
**per-site URL** as the AssertionConsumerService (reply URL). Configuring the IdP app
with the site URL as the entity ID, or forgetting to register the site's ACS as a
reply URL, produces two different opaque errors and a long debugging loop.

## WRONG
```text
IdP app (Entra) configuration:
  Identifier (Entity ID): https://mydomain--sandbox.sandbox.my.site.com/IAFCConnect
  Reply URL:              https://mydomain--sandbox.sandbox.my.site.com/IAFCConnect/login?so=00D...

Result on login:
  AADSTS700016: Application with identifier
  'https://mydomain--sandbox.sandbox.my.salesforce.com' was not found in the directory
  (Salesforce sent the ORG entity ID as issuer, not the site.)
```

## RIGHT
```text
IdP app (Entra) configuration:
  Identifier (Entity ID): https://mydomain--sandbox.sandbox.my.salesforce.com   <- ORG
  Reply URL(s):           https://mydomain--sandbox.sandbox.my.site.com/IAFCConnect/login?so=00D...  <- SITE ACS
  (add one reply URL per community site the same IdP app serves)

Salesforce SSO setting Entity ID field: the ORG My Domain, not the site.
Register reply URLs EXACTLY, including the ?so=<orgId> query string (exact-match).
```

## NOTES
- AADSTS700016 = the request's issuer (SP entity ID) matches no app Identifier -> fix
  the Identifier to the org My Domain.
- AADSTS50011 = the request's ACS (reply URL) is not registered -> add the site's
  Login URL (with ?so=) as a reply URL.
- One IdP app with the org Identifier + many site reply URLs serves every community
  in the org. Get the exact site Login URLs from Single Sign-On Settings > Endpoints.
- The `?so=<orgId>` parameter is always appended by Salesforce; Entra does exact-match
  reply URLs, so include it.
