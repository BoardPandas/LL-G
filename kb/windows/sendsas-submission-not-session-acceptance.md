---
tech: windows
tags: [sendsas, secure-attention, services, session-targeting, impersonation, native-acceptance]
severity: high
---
# SendSAS submission is not session-specific visual acceptance

## PROBLEM

`SendSAS` returns void. A clean call, IPC receipt, test exit, and verified token
session can all coexist with an unchanged Ctrl+Alt+Delete screen. Do not call a
remote-control fix accepted merely because its service harness exits zero.

In an isolated Windows 11 build 26200 guest, an actual SCM LocalSystem service
impersonated its exact service-created SYSTEM child in console session 1 and
called `SendSAS(FALSE)`. Policy was explicitly prepared as DWORD 1 (Services).
The call returned, reversion was verified, the child exited normally, and the
screen stayed on "Press Ctrl+Alt+Delete". Repeating with both processes kept
alive for a bounded observation window had the same result. A separate,
non-impersonating service-console control moved that same VM to sign-in.

That initial comparison proves a meaningful caller-path difference on the tested
artifact. Alone, it does not explain the failure or establish that a console-wide
call safely addresses every requested Windows session.

## WRONG

```go
sendSAS.Call(0) // A void return is not a success result.
return Receipt{Status: "unlocked", EffectConfirmed: true}
```

It is also wrong to promote a successful console-wide control into a
session-targeted implementation without evaluating console switches and
non-target-session effects.

## RIGHT

```go
// After authenticating the caller, checking policy and binding session authority:
sendSAS.Call(0)
return Receipt{Status: "submitted", EffectConfirmed: false}
```

Keep the runtime submission receipt distinct from native acceptance evidence:

1. Pin the executable hash, OS build, real SCM caller, retained child process
   identity, intended session, effective policy, and cleanup owner.
2. Observe the intended screen before and after one explicit request; do not
   substitute API completion or process exit for the expected visual transition.
3. Observe relevant non-target sessions and exercise console/session changes.
4. Preserve failed runs. Keep the native gate failed or unknown until both
   effect and targeting pass. A diagnostic control is not a production fallback.
5. Restore explicitly approved lab preparation and verify actual cleanup.

## Follow-up: caller identity and UIAccess

A later same-binary A/B/A test retained impersonation and changed only its token
source: the service's own session-0 SYSTEM token opened sign-in, the child session-1
SYSTEM token did not, and the service token worked again. Do not conflate SYSTEM
identity, process session, and effective thread-token session.

Read-only inspection of the matching Winlogon public symbols on that Windows
build supports the distinction: the active-console Services eligibility branch
checks the effective token's session 0; the UIAccess branch checks actual UIAccess
and the target session. Earlier branches exist, so this is a build-specific
observation, not a universal private-API contract or implementation recipe.

A separate, signed, protected-location helper launched by Windows with real
UIAccess=1 visibly reached sign-in under policy 2/3 and Windows Security from an
unlocked desktop. Its session-1 request did not disturb active session 2; explicitly
targeting session 2 opened its sign-in screen. The disconnected session-1 effect
was not observed. Policy 0/1 was refused before submission. The lab helper has no
production authentication and must not be promoted as-is.

For a UIAccess design, retain exact session authority and process authentication,
bounded lifetime, and per-request input permission. Require real Windows-granted
UIAccess, signing and protected installation; never mutate token UIAccess bits,
elevate the whole viewer, or toggle policy automatically to make a test pass.
A Services-only policy classifier cannot be reused unchanged for UIAccess.

Capture immediately: a screenshot several minutes later can show the lock screen
again and cannot establish whether an earlier SAS opened sign-in. Keep API
submission, visual effect, native targeting, and product deployment separate.

## NOTES

Microsoft documents caller eligibility, policy prerequisites, and service
impersonation, but those contracts still require native verification for the
actual token/session path. The recorded experiment is not a claim that all
Windows versions or all impersonated clients behave identically.

This lesson does not recommend registry toggles or policy overrides. Configure
any necessary prerequisite separately through its authorized owner. Do not
capture credentials while collecting sign-in evidence.

- [Microsoft SendSAS contract](https://learn.microsoft.com/en-us/windows/win32/api/sas/nf-sas-sendsas)
- [Service cleanup observation](service-stop-after-observed-crash.md)
- [Native Windows acceptance scope](native-windows-acceptance-reconcile-state-scope-msi-evidence.md)
