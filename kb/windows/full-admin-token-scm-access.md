---
tech: windows
tags: [uac, logonuser, impersonation, scm, token, elevation, windows-lab]
severity: high
---
# A full Admin logon token does not prove SCM access

## PROBLEM

A credential-elevation design can incorrectly classify every workgroup/local-admin
failure as UAC filtering, or declare elevation feasible as soon as LogonUser
returns a high-integrity token. Token acquisition, impersonation, the requested
resource access check, and process/service execution are separate boundaries.

A September 2026 Windows 11 build 26200 workgroup lab started from a genuine
standard user's console process: medium integrity, no Administrators SID, no
inspected elevation privileges, and local SCM CREATE_SERVICE denied with error 5.
With an ordinary local administrator credential, NETWORK logon returned a full,
high-integrity impersonation token, Administrators enabled, SecurityImpersonation
level. ImpersonateLoggedOnUser succeeded, but OpenSCManager returned error 1346
for both local and named loopback targets. The reason for that SCM rejection
was not established. It is not evidence that the returned token was UAC-filtered.

## WRONG

```text
LogonUser succeeded and returned high integrity -> elevation works.
OpenSCManager failed on a workgroup PC -> local-account UAC filtering.
Linked token is elevated -> CreateProcessWithTokenW will succeed.
Any failed step -> try every other password/logon combination automatically.
```

## RIGHT

```text
1. Verify the genuine standard-user caller and denied baseline.
2. Run one explicitly selected logon path with a known lab credential.
3. Record returned SID, integrity, elevation, group attributes, token type,
   impersonation level, and relevant privileges with query errors preserved.
4. Record impersonation success, then local and loopback SCM calls separately.
5. Preserve each numeric error and the exact boundary reached.
6. Record reversion and every handle/process/task cleanup result.
7. Gate implementation on the measured access/execution requirement,
   not on token appearance or the report process returning exit 0.
```

## NOTES

The same lab's INTERACTIVE logon returned a limited, medium-integrity Admin
token with deny-only Administrators and SCM error 5. Its linked token was full
and high integrity but SecurityIdentification-level; DuplicateTokenEx returned
1346, so process creation was never attempted. NEW_CREDENTIALS retained the
standard caller's local identity and both SCM calls returned error 5. These are
observations from one configuration, not a universal account/logon matrix.

1346 is ERROR_BAD_IMPERSONATION_LEVEL. A follow-up should inspect the effective
impersonating thread token and RPC authentication boundary before assigning the
NETWORK failure's root cause. Do not weaken UAC policy to manufacture a pass.
A successful SCM handle would still not prove service startup, SYSTEM execution,
secure-desktop access, or EDR compatibility.

- [LogonUser](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-logonuserw)
- [OpenSCManager](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-openscmanagerw)
- [Windows errors 1300–1699](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--1300-1699-)
- [CreateProcessWithTokenW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createprocesswithtokenw)

Account spelling is another independent boundary. In the same lab, Scheduler
registration with `.\\Admin` returned HRESULT 0x80070534 (ERROR_NONE_MAPPED).
Using the verified full `MACHINE\\Admin` identity with the same binary advanced
to registration access denied (0x80070005). The explicit-credential Scheduler
connection also returned access denied before registration. Qualify local
shorthand and resolve the account SID before requesting a password. Preserve
the initial mapping failure as setup evidence instead of counting it as an
elevation-policy verdict; never automatically retry a credential after a setup
or transport error.


A separate attended-vendor observation on the same workgroup host demonstrated
another path. From a genuine standard-user desktop, a helper started under the
supplied ordinary administrator at medium integrity with Limited elevation.
After the operator approved Windows UAC, a high-integrity Full administrator
helper appeared, followed by a LocalSystem service and SYSTEM agents in the
standard user's console session. The operator could then view and dismiss a
subsequent UAC prompt remotely. The temporary service was removed at session end;
the standard user's token and recorded UAC policy remained unchanged.

This is behavioral evidence for an attended consent path, not identification of
the vendor's exact API calls. Failed impersonation-only or no-prompt probes do
not disprove this path. Evaluate a supplied-credential process launch followed
by a Windows consent transition separately, with native token, service,
secure-desktop and cleanup checks. Do not infer a no-interaction mechanism from
technician-side credential entry when the endpoint user still approves UAC.
[CreateProcessWithLogonW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createprocesswithlogonw)
and the [Shell runas verb](https://learn.microsoft.com/en-us/windows/win32/shell/launch)
provide documented candidate building blocks, not proof of the observed vendor
implementation. No-prompt support and other account/policy matrices remain
separate unanswered questions.


When staging a pre-consent helper, keep its executable protected against
standard-user replacement while granting read/execute through an enabled SID.
An Administrators-only allow ACE does not grant access to a filtered token whose
Administrators group is deny-only. Granting authenticated users read/execute on
a non-secret lab binary, while retaining SYSTEM/Administrators-only write access
under a protected parent directory, permits the standard caller and the filtered
helper to load the same artifact. Inspect the effective ACLs during native
verification. This follows the documented
[SID access-check rules](https://learn.microsoft.com/en-us/windows/win32/secauthz/sid-attributes-in-an-access-token);
it is not a claim that the new consent probe has already passed on hardware.

Keep cleanup evidence separate from request timeout. Killing an initiating
helper does not establish that a broker-owned Windows UAC dialog was dismissed.
An expiring fixed helper must refuse a late approval, and a timeout must remain
inconclusive/cleanup-unverified until the operator checks the prompt and process
exits. A process-local lifetime guard also cannot run while its new process is
left suspended; avoid a suspended launch if startup does not require one.

A subsequent domain-joined Windows 11 build 26200 lab used
CreateProcessWithLogonW(LOGON_WITH_PROFILE) from a verified standard-user
console process. The selected domain Administrator account (domain SID ending
in 500) produced an already elevated primary helper token: high integrity,
Default elevation type, Administrators enabled, and the expected SID/session.
A probe requiring a filtered Admin helper correctly stopped before its runas
stage and terminated the owned helper. No Windows-consent response or elevated
SCM access was measured. This is a successful credential-based process launch
with an out-of-scope token for that consent experiment, not a credential failure,
UAC denial, or proof of SCM/service feasibility. Do not predict this result for
all domain accounts or assign its policy cause from an account name alone.

For a filtered-to-elevated consent comparison, select an existing ordinary
administrator subject to filtering and inspect the actual helper token again.
Keep an already elevated launch as a separate measured branch; never silently
relax the consent test's guard and label the resulting path consent-approved.
Record PromptOnSecureDesktop as well: a host with value 0 cannot provide
secure-desktop control evidence without a separately authorized configuration
change and a new measurement.

The follow-up measured that already elevated domain-credential path separately.
A fixed helper launched by CreateProcessWithLogonW(LOGON_WITH_PROFILE), from the
same genuine standard user's console session, successfully opened and closed
local SCM with SC_MANAGER_CREATE_SERVICE. Expected domain RID-500 SID/session,
primary high-integrity elevated token, enabled Administrators, protected artifact
hash and OS pipe peer PID were checked before authorizing the fixed access call.
The helper exited zero, all handle cleanup passed, and an independent post-run
baseline still had the standard token and SCM denied. Temporary launchers and
helper processes were absent after cleanup.

This is a positive credential-process/SCM result for one configuration, distinct
from a filtered-to-elevated Windows-consent result. Keep a dedicated experiment
and verdict for each branch. A consent-only guard can correctly reject an already
elevated origin while the account remains usable for a separately authorized
measurement. The positive handle now supports a scoped service-lifecycle lab;
it still does not establish service startup, SYSTEM execution, desktop handoff,
secure-desktop control, other account-policy matrices or production readiness.
