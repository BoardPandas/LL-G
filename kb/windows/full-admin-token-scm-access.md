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
