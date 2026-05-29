---
tech: intune
tags: [intune, rdp, remote-credential-guard, credssp, entra, mdm, azure-vm, mstsc]
severity: high
---
# Intune "Require Remote Credential Guard" breaks RDP to Entra-joined / IP / non-Kerberos targets

## PROBLEM
The CredSSP policy "Restrict delegation of credentials to remote servers = Require Remote Credential Guard" (Intune Settings Catalog ADMX_CredSsp, or equivalent GPO) forces Remote Credential Guard (RCG) on every OUTBOUND RDP connection from the device. RCG depends on Kerberos (a resolvable SPN, i.e. connecting by hostname in an AD domain). It cannot be used when connecting by IP address, to an Entra-ID-joined VM using web sign-in, or to a workgroup host. When RCG is *required* (not merely preferred), those connections fail at the RDP TLS/CredSSP handshake with:

"An authentication error has occurred. The requested security package does not exist" (SEC_E_SECPKG_NOT_FOUND, 0x80090305)

Why it is hard to diagnose:
- The wording is misleading: it sounds like a missing or broken SSP on the client, but the SSPs are fine.
- It fails BEFORE any Entra authentication, so there are zero Entra sign-in logs to inspect (do not waste time in Conditional Access / sign-in logs).
- Both classic mstsc.exe AND the modern Windows App (bundled msrdc.exe) fail identically, because they share the OS credential-delegation policy. Swapping RDP clients does not help.
- Toggling "use a web account to sign in" does not help; RCG overrides the auth method entirely.
- RDP to on-prem AD machines BY HOSTNAME still works (Kerberos succeeds). So the box "can RDP", just not to the IP/Entra targets, which misdirects toward a network or firewall theory.
- An unmanaged machine works fine (it never receives the policy), which is easy to misread as per-machine corruption rather than a policy difference.

Red herrings to avoid: the empty `HKLM\SYSTEM\CurrentControlSet\Control\Lsa\Security Packages` value is NORMAL on Win11 (old articles telling you to repopulate kerberos/msv1_0/schannel/wdigest/tspkg/pku2u are pre-Win10 and wrong here); RDP client / mstscax.dll version; credssp.dll version; Windows Firewall; PKU2U AllowOnlineID. Compare against an unmanaged peer before chasing any of these.

## WRONG
```text
# Diagnose: read the enforced policy on the FAILING (Intune-managed) client
HKLM\SOFTWARE\Policies\Microsoft\Windows\CredentialsDelegation
  RestrictedRemoteAdministration      = 1
  RestrictedRemoteAdministrationType  = 2   # 2 = Require Remote Credential Guard  <-- the culprit

# Result: RDP to an Entra-joined Azure VM by IP fails with
#   "The requested security package does not exist" (0x80090305)
# while RDP to an on-prem AD server by FQDN succeeds.
```

## RIGHT
```text
# Confirm it is the policy: compare the failing managed machine to an UNMANAGED one,
# or clear it locally and retest (Intune re-asserts on next sync, so it is temporary):
Set RestrictedRemoteAdministration = 0   # HKLM\SOFTWARE\Policies\Microsoft\Windows\CredentialsDelegation
# mstsc/msrdc read this per-connection, so no reboot is needed to retest.

# Durable fixes (choose per security posture):
# 1. Exclude the device: add it to an exclusion group on the Intune policy (targeted, cleanest).
# 2. Relax the policy: set "Restrict delegation of credentials to remote servers" to Not Configured/Disabled.
# 3. Keep RCG: make targets RCG-compatible (AD domain-join the VMs + connect by FQDN, or use a Bastion/jump host).

# Locate the policy via Graph (Intune Settings Catalog), needs DeviceManagementConfiguration.ReadWrite.All:
#   GET /beta/deviceManagement/configurationPolicies
#       -> find the one whose /settings contain
#          device_vendor_msft_policy_config_admx_credssp_restrictedremoteadministration
#   GET .../{id}/assignments  -> see which groups it targets
#   POST .../{id}/assign  with {"assignments":[]}  to unassign fleet-wide (reversible)
```

## NOTES
RestrictedRemoteAdministrationType values: 1 = Require Restricted Admin, 2 = Require Remote Credential Guard, 3 = Restrict Credential Delegation. Only Not Configured/Disabled is guaranteed to allow normal NLA/Entra delegation to arbitrary targets. This is a per-device, not per-destination, control, so you cannot keep RCG for on-prem RDP while disabling it only for Azure/IP targets via this one setting. RCG adds little for Entra-VM access (token auth, not AD credential delegation) but does protect AD credentials delegated to on-prem RDP hosts, so weigh that before disabling fleet-wide. Effective registry written by the policy lives at HKLM\SOFTWARE\Policies\Microsoft\Windows\CredentialsDelegation.
