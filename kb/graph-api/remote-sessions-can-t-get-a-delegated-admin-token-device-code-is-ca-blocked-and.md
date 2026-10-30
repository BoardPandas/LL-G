---
tech: graph-api
tags: [entra, device-code, conditional-access, oauth, app-registration, consent]
severity: medium
---
# Remote sessions can't get a delegated admin token: device code is CA-blocked and nativeclient paste-back is stripped

## PROBLEM
From an agent on a remote host, neither device-code sign-in nor an auth-code paste-back reliably yields a delegated admin token for provisioning an app registration.
In Entra ID P2 tenants Microsoft's managed "block device code flow" Conditional Access policy rejects device code ("You don't have access to this"). The auth-code fallback with redirect `https://login.microsoftonline.com/common/oauth2/nativeclient` shows an anti-phishing page and redirects to `/common/wrongplace`, discarding the code; a `http://localhost` redirect can hang in an embedded browser. Each failed attempt can still record consent: the first one left a tenant-wide (AllPrincipals) grant on Microsoft Graph Command Line Tools.

## WRONG
```text
1. Start device-code flow with the Graph CLI public client -> blocked by CA
2. Send the user an authorize URL with redirect_uri=.../nativeclient, ask them to paste the final URL -> code stripped
```

## RIGHT
```text
1. Generate the cert locally; give the user only the public .cer.
2. User, in the portal: create the app registration, upload the cert, add and admin-consent
   ONLY Application.ReadWrite.All + AppRoleAssignment.ReadWrite.All (assign any directory role here too).
3. Agent, as the app (cert client-credentials):
   PATCH /applications/{id}  { requiredResourceAccess: [...full set...] }
   POST  /servicePrincipals/{sp}/appRoleAssignments  for each missing role (consent is immediate)
```

## NOTES
Do not try to work around the anti-phishing redirect. After any failed attempt, check `/oauth2PermissionGrants?$filter=clientId eq '<cli-tools-sp-id>'` and remove a leftover AllPrincipals grant (deleting the enterprise app is simplest). The two bootstrap permissions let the app grant itself anything, so treat its private key as tenant-admin equivalent.
