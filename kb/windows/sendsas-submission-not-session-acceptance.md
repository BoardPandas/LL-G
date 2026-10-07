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

That comparison proves a meaningful caller-path difference on the tested
artifact. It does not prove why the targeted path failed, nor that a
console-wide call safely addresses every requested Windows session.

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
