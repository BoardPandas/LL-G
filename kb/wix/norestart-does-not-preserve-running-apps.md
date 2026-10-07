---
tech: wix
tags: [windows, msi, restart-manager, auto-update, process-lifetime, remote-viewer]
severity: high
---
# MSI norestart does not preserve running applications

## PROBLEM

An automatic MSI update can close an active application even when launched
with `/quiet /norestart`. That switch suppresses rebooting; it does not mean
"leave application processes running." Restart Manager normally closes
applications holding package files during silent installation. Separately,
an installer's custom process-cleanup action can terminate the same application.
Changing only one path leaves the other intact.

The disappearance can look like an application crash: the entire viewer window
closes without a corresponding fault event. Correlate application startup,
MSI/Restart Manager logs and explicit cleanup code before attributing the cause.
Absence of a crash event does not prove a particular process was terminated by
the installer.

## WRONG

```go
// This does not promise that an existing viewer will stay open.
cmd := exec.Command("msiexec.exe", "/i", verifiedMSI, "/quiet", "/norestart")
err := cmd.Start()
// Treating err == nil as installation completion also releases any in-process
// update reservation too early: the installer runs outside this service.
```

It is also wrong to disable Restart Manager but leave a residual-process list
that includes active viewers, or to claim that a one-time process snapshot
atomically excludes new viewer launches during installation.

## RIGHT

Separate deliberate-shutdown defense from the stronger promise of uninterrupted
sessions or atomic viewer/update admission.

```xml
<!-- Author in the incoming Package, not in a late custom action. -->
<Property Id="MSIRESTARTMANAGERCONTROL" Value="DisableShutdown" />
```

That property preserves files-in-use detection while disabling Restart Manager
shutdown mitigation for the package. Putting it in the incoming package also
avoids depending on an older updater knowing a new command-line option.

Audit custom cleanup independently. Exclude outgoing viewers during update or
repair, retain exact installed-image checks for every process still targeted,
and keep explicit full-uninstall cleanup separately conditioned. Do not let
the old-product removal stage invoke full cleanup during a major upgrade.
Preserve existing service-drain and configuration-preservation safeguards.

Test cleanup using owned temporary child processes: an update must spare its
viewer, explicit uninstall must stop it, and a same-named child outside the
test installation directory must survive both. Never point such a fixture at
the real installation or call service-control commands to test the helper.

## NOTES

- These measures remove identified deliberate shutdown paths. They do not prove
  session continuity while files or frontend assets are replaced. In-use files
  may require deferred replacement or a reboot. Keep `/norestart`; report the
  pending state instead of force-closing applications to hide it.
- Verify the real package, predecessor removal, active-session behavior,
  reconnect, failure and rollback on an approved native test system. XML tests,
  process-helper tests, a successful MSI launch and product-version metadata
  are not substitutes for that acceptance.
- For strict no-overlap admission, ownership must outlive service shutdown and
  cover installer completion or rollback. An inherited client handle is not
  proof that Windows Installer server work has finished after client death.
  An ownerless MSI transaction rolls back, but that does not document rollback
  completion before the owner's unrelated handles are released. Old viewers
  that never acquired a new lease also need an explicit bootstrap strategy.
- This lesson was supported by installer logs and four non-skipped,
  race-enabled Windows process-cleanup tests. Full MSI continuity was still
  pending at publication; do not turn that narrower evidence into a claim that
  all upgrade races are fixed.
- Enforcement belongs in product installer/process tests, not a Claude/Codex
  configuration guard. This is a Windows Installer lifetime issue.

References:

- [Microsoft: MSIRESTARTMANAGERCONTROL](https://learn.microsoft.com/en-us/windows/win32/msi/msirestartmanagercontrol)
- [Microsoft: Windows Installer with Restart Manager](https://learn.microsoft.com/en-us/windows/win32/msi/using-windows-installer-with-restart-manager)
- [Microsoft: MsiBeginTransaction](https://learn.microsoft.com/en-us/windows/win32/api/msi/nf-msi-msibegintransactionw)
- [MSI metadata does not prove binary replacement](../windows/msi-success-does-not-prove-service-upgrade.md)
- [Source regression and scoped native evidence](https://github.com/BoardPandas/supportforge-platform/blob/fb2bcb9c0a96205f4750ca3a0c5dfbc347a69e8a/tasks/2026-10-07-viewer-installer-defense-execution.md)
