---
tech: entra-external-id
tags: [entra, external-id, ciam, microsoft-account, msa, oidc, federation, identity-providers]
severity: medium
---
# Microsoft personal accounts are NOT a built-in IdP in external tenants

## PROBLEM
External tenants ship built-in federation for Google, Facebook, and Apple, but NOT for
Microsoft personal accounts (MSA). The assumption "it's Microsoft's own product, surely
the Microsoft button is a checkbox" is wrong: a "Sign in with Microsoft" option requires
building custom OIDC federation to live.com, including its own app registration and
client secret.

## WRONG
```text
Look for "Microsoft" under External Identities > All identity providers > Built-in
in the external tenant and expect to toggle it on. It is not there.
(The workforce tenant's blade DOES list Microsoft; that's B2B guest settings,
not CIAM; see the lookalike-blade entry.)
```

## RIGHT
```text
1. In the external tenant, App registrations > New registration:
   - account types: "Any org directory + personal Microsoft accounts" (multitenant+MSA)
   - Web redirect URI:
     https://<subdomain>.ciamlogin.com/<subdomain>.onmicrosoft.com/federation/oauth2
     (add the tenant-GUID variant as a second URI)
   - create a client secret, copy the Value immediately
2. External Identities > All identity providers > Custom tab > Add new > OpenID Connect:
   - Well-known endpoint:
     https://login.microsoftonline.com/consumers/v2.0/.well-known/openid-configuration
   - Issuer URI: https://login.live.com
   - client_secret auth, scope "openid profile email", response type "code"
3. User flows > (flow) > Identity providers > check the new Microsoft Account provider.
```

## NOTES
Custom OIDC providers get a generic blue-circle icon that cannot be replaced (see the
icon entry). Work/school Microsoft accounts are a different integration (Microsoft
Entra ID federation), and for member bases that "prefer work email" it may matter more
than MSA.
