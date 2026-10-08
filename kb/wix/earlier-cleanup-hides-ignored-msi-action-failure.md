---
tech: wix
tags: [wix, msi, custom-action, quietexec, uninstall, verification]
severity: high
---
# Earlier cleanup can hide an ignored MSI action failure

## PROBLEM

A cleanup custom action can fail while Windows Installer still reports success. With `Return="ignore"`, the failure is logged but does not fail the installation. An earlier action may already have removed the same resource, making an absence assertion pass without proving the later action worked.

This becomes visible during full uninstall if the earlier cleanup is excluded by its condition. An install-then-uninstall test that never recreates the resource can miss the defect again: uninstall has nothing left to remove.

In a native reproduction, install, repair, and uninstall each returned zero. Install and repair removed a disabled legacy scheduled-task fixture through earlier cleanup. After independently reseeding that task before uninstall, it survived uninstall. The later QuietExec64 action rejected its unquoted executable and returned `0x80070057`; the ignored error did not change the overall MSI result.

## WRONG

```xml
<!-- Bare, unquoted executable; ignored failure can be concealed by earlier cleanup. -->
<CustomAction Id="SetRemoveTrayTask"
  Property="RemoveTrayTask"
  Value="schtasks.exe /Delete /F /TN &quot;SupportForge\SupportForgeTray&quot;" />
<CustomAction Id="RemoveTrayTask" BinaryKey="WixCA"
  DllEntry="CAQuietExec64" Execute="deferred"
  Impersonate="no" Return="ignore" />
```

```text
seed task
install MSI
assert exit code == 0
assert task absent
uninstall MSI
assert exit code == 0
assert task absent  # vacuous: install already removed it
```

## RIGHT

Quote the application path and resolve the intended system executable explicitly. Keep the deferred action's command in its matching property.

```xml
<CustomAction Id="SetRemoveTrayTask"
  Property="RemoveTrayTask"
  Value="&quot;[System64Folder]schtasks.exe&quot; /Delete /F /TN &quot;SupportForge\SupportForgeTray&quot;" />
```

Test each installer transition with a fresh, owned fixture:

```text
for operation in [install, repair, full uninstall]:
    require exact resource absent before fixture creation
    create disabled, trigger-free, inert test task
    assert exact task exists and matches fixture ownership
    run hash-pinned MSI operation
    assert MSI result is accepted
    assert exact task absent
    inspect that operation's custom-action log
```

Resource-query errors must fail the test, not become "absent." Preserve an unrelated sentinel to check cleanup stays scoped. Use a disposable, checkpointed machine; never seed or remove a production task merely to test uninstall.

## NOTES

- `Return="ignore"` may be intentional for best-effort cleanup, including an already absent resource. Do not silently change that product contract. Use a failing return policy when cleanup success is mandatory, and verify effects either way.
- Apply fresh-resource testing to services, files, registry entries, and other cleanup targets too.
- Source assertions can catch command construction, but cannot prove a rebuilt MSI executed it. Require the exact signed package, action-specific logs, and native postconditions.
- The reproduction used candidate 3.303.0.0 and failed after 58.39 seconds despite three successful MSI return codes. The source correction and regression test were committed as `97a869f95`; corrected-package native acceptance was still pending when recorded.
- This is a technology/testing lesson, not a repository configuration defect; it does not call for a Claude configuration guard.

References: [FireGiant QuietExec documentation](https://docs.firegiant.com/wix/tools/wixext/quietexec/), [reproduction, source correction, and evidence limits](https://github.com/BoardPandas/supportforge-platform/blob/97a869f9599f8115de064486c83a11a4da64243b/tasks/2026-10-07-real-msi-cleanup-execution.md).
