---
tech: linux
tags: [systemd, reboot, verification, incident-response, service-management, journald]
severity: high
---
# Post-reboot verification that only checks the front door misses units that died at boot

## PROBLEM

Confirming that the web server answers HTTP 200 after a reboot does not prove the host came
back. A reverse proxy or web tier is independent of the application units behind it, so a
unit can exit non-zero seconds into boot while the front door stays perfectly healthy. If
nothing routes to that unit, or it serves background work rather than requests, the HTTP
check is guaranteed to pass regardless of its state.

Two things make this worse than an ordinary miss. The failure is invisible in the signal
everyone reaches for, and journald rotation eventually erases the boot-time error, so by the
time anyone notices, the failure is also undiagnosable.

Real case: an outage ticket was closed on "Apache is running, listening, and returning normal
responses." A Celery unit on the same host had failed **12 seconds into that same reboot** and
stayed failed for **75 days**, surfacing only during an unrelated ticket months later. By then
`journalctl -u <unit>` returned `-- No entries --`.

## WRONG

```bash
# "verified healthy" after the reboot, ticket closed
systemctl is-active apache2
# active

curl -sS -o /dev/null -w '%{http_code}\n' https://site.example.com/
# 200
```

## RIGHT

```bash
# Enumerate everything that failed, THEN check the front door.
systemctl list-units --failed --no-pager
systemctl is-system-running          # "running" vs "degraded"

# Better: baseline BEFORE the reboot so the after-list is unambiguous.
systemctl list-units --failed --plain --no-legend | awk '{print $1}' | sort > /tmp/failed.before

# ... reboot ...

systemctl list-units --failed --plain --no-legend | awk '{print $1}' | sort > /tmp/failed.after
comm -13 /tmp/failed.before /tmp/failed.after   # units THIS reboot broke

# Grab the boot-time error while it still exists.
journalctl -u <unit> -b --no-pager
```

## NOTES

- `systemctl is-system-running` returns `degraded` if any unit has failed, which makes it a
  one-command smoke test suitable for a close-out checklist.
- **Take the before-baseline.** A host that already has failed units makes the after-list
  ambiguous, and that ambiguity is what lets a new failure hide behind a known one. The diff
  is what separates "already broken" from "the reboot broke it."
- A socket-activated unit showing `inactive (dead)` is **normal**, not a fault, provided its
  `.socket` unit is `active (listening)`. Do not chase it.
- Capture `journalctl -u <unit> -b` promptly. Once the journal rotates you lose the only
  record of why it failed, and you are left reconstructing from the unit file.
- A permanently failed unit that nobody intends to fix should be disabled or removed, not
  left in place. It poisons every future `--failed` check by masking new failures in noise.
- Related: [Daemon stays dead after an auto-upgrade restart](systemd-restart-on-abort-bind-race.md),
  which is the failure mode this verification gap most often hides.
