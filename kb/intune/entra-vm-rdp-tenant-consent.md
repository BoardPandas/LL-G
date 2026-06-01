---
tech: intune
tags: [intune, entra, rdp, azure-vm, consent, oauth2, microsoft-remote-desktop, aadsts50206, aadsts65002]
severity: high
---
# Azure VM Entra-ID RDP fails until Microsoft Remote Desktop has a tenant-wide consent grant for Azure Windows VM Sign-In

## PROBLEM
Connecting to an Entra-joined Azure VM by IP via Remote Desktop using an Entra account looks like it should "just work" once the standard prerequisites are met:

- The VM has the `AADLoginForWindows` extension installed.
- The connecting user holds the **Virtual Machine User Login** or **Virtual Machine Administrator Login** RBAC role on the VM / RG / subscription.
- The client is a supported version of the Windows App or mstsc.

But you can satisfy all of the above and still fail, with confusingly varied symptoms:

- The Windows App or mstsc shows: *"An authentication error has occurred. The requested security package does not exist."* (`0x80090305`).
- After more troubleshooting, the failure mode shifts to: *"User authentication failed (`0xD000006D`)"* while the RDPClient log records *"Fetching the RDS AAD App ID from the clientoptions endpoint failed (`0x8000FFFF`)"* and *`TsSslInRdsAadHandshake -> TsSslEventRdsAaadHandshakeFailed`*.
- The Entra sign-in log records **AADSTS50206**: *"The user or administrator has not consented connecting to the target-device: '{identifier}'. Send an interactive authorization request for this user and target-machine"*, against the Windows 365 Client app calling the Microsoft Remote Desktop resource.
- An attempted admin-consent URL fails with **AADSTS65002**: *"Consent between first party application 'a4a365df-...' and first party resource '00000002-0000-0000-c000-000000000000' must be configured via preauthorization"*. The `00000002-...` resource is the retired Azure AD Graph API.

What is actually happening:

The Microsoft Remote Desktop client (appId `a4a365df-50f1-4397-bc59-1a1564b8bb9c`) needs delegated `user_impersonation` access to the Azure Windows VM Sign-In resource (appId `372140e0-b3b7-4226-8ef9-d57986796201`) on behalf of the connecting user. Microsoft expects this to be granted by **user interactive consent** at first connect, or pre-granted by an admin. But:

1. Microsoft Remote Desktop's app manifest still references the retired Azure AD Graph permission. The generic admin-consent URL (`/adminconsent?client_id=a4a365df-...`) tries to consent to the *whole* manifest and fails with AADSTS65002 because only Microsoft can authorize first-party-to-first-party AAD Graph permissions.
2. The interactive user-consent prompt in the Windows App often does not surface for ad-hoc PC connections (it works for feed-published Windows 365 / AVD targets but not for arbitrary Azure VMs reached by IP), so users never get a chance to self-consent.
3. With no tenant-wide grant and no surfaced prompt, the OBO from Microsoft Remote Desktop to Azure Windows VM Sign-In never succeeds, and the AAD-RDP handshake collapses with "user authentication failed".

Red herrings that wasted hours during diagnosis (do not stop at any of these):

- An Intune **"Require Remote Credential Guard"** policy (`RestrictedRemoteAdministrationType=2` written to `HKLM\SOFTWARE\Policies\Microsoft\Windows\CredentialsDelegation`) is a real *intermediate* blocker that forces a Kerberos-only flow incompatible with Entra-joined VMs reached by IP. Clearing it changes the failure mode from a basic CredSSP/SSL handshake error to the more accurate AAD-handshake error above. Fix RCG if it is set, but it is not the finish line.
- Empty `HKLM\SYSTEM\CurrentControlSet\Control\Lsa\Security Packages` is normal on Windows 11. Articles telling you to repopulate it with `kerberos,msv1_0,schannel,wdigest,tspkg,pku2u` are pre-Windows-10 and irrelevant.
- `credssp.dll` version is typically identical on the working and the broken machine.
- Windows Defender Firewall, `pku2u\AllowOnlineID`, and Cloudflare WARP / Zero Trust posture are almost never the cause once the connection has reached the server (look for the `1028 Server supports SSL = supported` event in `Microsoft-Windows-TerminalServices-RDPClient/Operational`).
- `dsregcmd /status` run from a SYSTEM context (e.g., RMM remote command) reports empty `NgcSet` / `WamDefaultSet` / `AzureAdPrt` because those fields are *per-user-session*. Always have the actual user run it in their own session before drawing conclusions.
- Conditional Access for VM Sign-In: most tenants already exclude the `372140e0-...` app from MFA-requiring policies. Verify before blaming CA.

## WRONG
```text
# Trying to admin-consent in the Entra portal or via the standard URL → fails:
GET https://login.microsoftonline.com/{tenant}/adminconsent?client_id=a4a365df-50f1-4397-bc59-1a1564b8bb9c
→ AADSTS65002: Consent between first party application 'a4a365df-50f1-4397-bc59-1a1564b8bb9c'
  and first party resource '00000002-0000-0000-c000-000000000000' must be configured via
  preauthorization.

# Telling users to "sign in via windows.cloud.microsoft web client to force interactive
# consent" → wrong, that client only shows feed-published Windows 365 Cloud PCs and AVD
# host pools, not arbitrary Azure VMs reached by IP.
```

## RIGHT
```text
# Create a targeted oauth2PermissionGrant for ONLY the scope that is actually needed.
# This bypasses the legacy-manifest issue because you are not consenting to the whole app,
# just the specific Microsoft Remote Desktop -> Azure Windows VM Sign-In relationship.

# 1. Make sure both SPs exist in your tenant (idempotent provisioning of first-party SPs):
GET /v1.0/servicePrincipals?$filter=appId eq 'a4a365df-50f1-4397-bc59-1a1564b8bb9c'
GET /v1.0/servicePrincipals?$filter=appId eq '372140e0-b3b7-4226-8ef9-d57986796201'
# If missing for either, create it (no permissions are granted; just instantiates the SP):
POST /v1.0/servicePrincipals  body: { "appId": "<the appId>" }

# 2. Grant the tenant-wide delegated consent:
POST https://graph.microsoft.com/v1.0/oauth2PermissionGrants
{
  "clientId":    "<SP objectId of Microsoft Remote Desktop in your tenant>",
  "resourceId":  "<SP objectId of Azure Windows VM Sign-In in your tenant>",
  "consentType": "AllPrincipals",
  "scope":       "user_impersonation"
}

# Required permission on the calling Graph app: DelegatedPermissionGrant.ReadWrite.All
# (or do it as a Global Admin in Graph Explorer / a script).

# 3. Verify by direct GET on the returned grant id (filter-by-clientId is briefly
# eventually-consistent and may return 0 results for a few seconds).
GET /v1.0/oauth2PermissionGrants/{grantId}

# Rollback: DELETE /v1.0/oauth2PermissionGrants/{grantId}
```

## NOTES
First-party app IDs that participate in Azure VM Entra-ID RDP:

- `a4a365df-50f1-4397-bc59-1a1564b8bb9c` Microsoft Remote Desktop (the client)
- `372140e0-b3b7-4226-8ef9-d57986796201` Azure Windows VM Sign-In (the resource)
- `270efc09-cd0d-444b-a71f-39af4910ec45` Windows Cloud Login (also touched by the modern flow)

Look-before-you-leap diagnostic order:

1. Pull the user's Entra sign-in log for the last 24h. AADSTS50206 against Microsoft Remote Desktop is the smoking gun.
2. Query existing `oauth2PermissionGrants` where the client is Microsoft Remote Desktop's SP and the resource is Azure Windows VM Sign-In's SP. Zero results means no one in the tenant has ever completed an Entra-RDP consent.
3. Have the actual logged-on user run `dsregcmd /status` themselves and confirm `AzureAdPrt: YES` and `WamDefaultSet: YES`. Do not draw conclusions from a SYSTEM-context run.
4. Only after ruling the above out, investigate RCG and other Intune policies that could block the flow upstream.

This grant is tenant-wide via `consentType: AllPrincipals`. It is *not* per-target-device despite what the 50206 wording suggests; one grant covers every user against every Azure VM in the tenant.
