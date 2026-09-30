---
tech: go
tags: [kardianos-service, launchd, macos, systemd, service-restart]
severity: high
---
# kardianos/service restarts a daemon named after Config.Name, not the one your installer loaded

## PROBLEM
On darwin, `service.Service.Restart()/Stop()/Start()` address a LaunchDaemon plist derived from `service.Config.Name` (e.g. `/Library/LaunchDaemons/SupportForgeAgent.plist`). When the PKG installs its own plist under a different label (e.g. `com.supportforge.service`, bootstrapped by postinstall), kardianos targets a job that does not exist and the real daemon is never restarted. The same mismatch happens on Linux when the package ships its own systemd unit name. Nothing about the call reads as wrong, and on the developer's machine (installed via `-install`) it works.

## WRONG
```go
s, _ := service.New(prg, &service.Config{Name: "SupportForgeAgent"})
_ = s.Restart() // restarts SupportForgeAgent.plist, which the PKG never installed
```

## RIGHT
```go
// darwin: restart the job the installer actually bootstrapped
exec.Command("/bin/launchctl", "kickstart", "-k", "system/com.supportforge.service").CombinedOutput()
// linux: the packaged unit, not Config.Name
exec.Command("systemctl", "restart", "supportforge-agent.service").CombinedOutput()
```

## NOTES
Only use kardianos control calls where kardianos itself installed the service. Windows is fine when the MSI's ServiceInstall Name equals Config.Name.
