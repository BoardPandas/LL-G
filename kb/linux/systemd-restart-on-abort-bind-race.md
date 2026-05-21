---
tech: linux
tags: [systemd, apache, unattended-upgrades, needrestart, restart-policy, socket-bind, outage]
severity: high
---
# Daemon stays dead after an auto-upgrade restart (socket bind race + Restart=on-abort)

## PROBLEM
A web/socket daemon (commonly Apache `apache2`, but the pattern applies to any service that binds a fixed port) can silently stay down for hours after a routine automatic package update, producing connection-refused with no obvious trigger.

Chain of events:
1. `unattended-upgrades` installs a library the daemon links against (e.g. `libgnutls30t64` on Ubuntu 24.04).
2. `needrestart` decides the daemon must restart and issues a `stop` + `start`.
3. The new master tries to bind the listen sockets before the old worker processes have fully released them, so it fails:
   `(98)Address already in use: AH00072: make_sock: could not bind to address [::]:80` / `no listening sockets available, shutting down`.
4. The packaged unit ships `Restart=on-abort`, which only restarts on an abnormal signal abort. A failed *start* that exits with `status=1/FAILURE` is NOT covered, so systemd gives up and leaves the unit `failed`.

Result: nothing is listening, the site refuses all connections, and it stays that way until a human manually restarts the service or reboots. There is no auto-recovery. Easy to misdiagnose because the box is up, memory/disk are fine, and the only clue is buried in the previous boot's journal.

Separately, the `AH00558: Could not reliably determine the server's fully qualified domain name, using 127.0.0.1. Set the 'ServerName' directive globally to suppress this message` line is benign cosmetic noise emitted on every start/reload. It is NOT the cause of the outage but is frequently mistaken for one during incident triage.

## WRONG
```ini
# Default packaged apache2.service (effective policy)
# Restart=on-abort  -> does NOT cover an exit-code start failure.
# When a post-upgrade restart loses the bind race, the unit goes to
# 'failed' and is never retried. Site is down until manual intervention.
[Service]
Restart=on-abort
```

## RIGHT
```ini
# /etc/systemd/system/apache2.service.d/override.conf
# A failed start now auto-retries; by the 5s retry the old sockets are freed.
[Unit]
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Restart=on-failure
RestartSec=5s
```
```bash
# Apply and verify (root):
systemctl daemon-reload
systemctl show apache2 -p Restart -p RestartUSec -p StartLimitBurst -p StartLimitIntervalUSec
# Expect: Restart=on-failure, RestartUSec=5s, StartLimitBurst=5, interval 2min
```

## NOTES
- Detection: `journalctl -b -1 -u apache2` (previous boot) showing `Address already in use` + `Failed with result 'exit-code'` immediately after an apt / unattended-upgrade entry. Confirm the trigger with `zgrep 2026-05-21 /var/log/apt/history.log*` and `/var/log/unattended-upgrades/unattended-upgrades.log`.
- Same failure mode affects nginx, postfix, and any daemon with a fixed listen port whose packaged unit lacks an exit-code restart policy. Audit with `systemctl show <svc> -p Restart`.
- Real-world context: Ubuntu 24.04 Azure VM, `libgnutls30t64` security update triggered the restart, ~6 hour connection-refused outage resolved by a manual reboot.
- The `ServerName` warning is cured (optional, cosmetic) by `echo "ServerName <fqdn>" > /etc/apache2/conf-available/servername.conf && a2enconf servername && systemctl reload apache2`. Do not treat its presence as an outage indicator.
- Optional hardening: move `unattended-upgrades` to a predictable overnight window so any service-affecting restart lands off-hours.
