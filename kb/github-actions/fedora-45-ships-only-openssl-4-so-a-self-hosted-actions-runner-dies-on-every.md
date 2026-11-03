---
tech: github-actions
tags: [self-hosted-runner, fedora, openssl, dotnet, system-upgrade, reboot, systemd]
severity: high
---
# Fedora 45 ships only OpenSSL 4, so a self-hosted Actions runner dies on every start after the upgrade

## PROBLEM
After `dnf system-upgrade` to Fedora 45, a self-hosted GitHub Actions runner exits on every start, because Fedora 45 ships only OpenSSL 4 (`libssl.so.4`) and the runner's .NET 8 runtime loads OpenSSL 3 (`libssl.so.3`).
It is not obvious for three reasons. The host and its Docker containers stay healthy, because containers bring their own userspace. systemd retries a few times and then leaves the unit `inactive (dead)` with exit status 0. GitHub shows the runner as `offline`, and every CI and deploy job sits in the queue with no error anywhere in the Actions UI. The real cause appears only in the runner's own `_diag/Runner_*.log`:

```text
System.PlatformNotSupportedException: OpenSSL is required for algorithm 'RSAOpenSsl' but could not be found or loaded.
```

A related trap: any host reboot kills the job in flight with `The runner has received a shutdown signal` and no test output. That looks like a CI failure, but nothing is wrong with the code.

## WRONG
```bash
# Upgrade the runner host and assume the runners come back with it
sudo dnf system-upgrade download --releasever=45
sudo dnf system-upgrade reboot
# ...hours later, CI is "stuck"; restarting the unit only loops the same crash
sudo systemctl restart actions.runner.<org>-<repo>.<name>.service
```

## RIGHT
```bash
# Install the OpenSSL 3 compat libraries next to OpenSSL 4, then restart the runner
sudo dnf install -y openssl3-libs
sudo systemctl restart actions.runner.<org>-<repo>.<name>.service

# After ANY reboot or OS upgrade, check every runner on the host
systemctl is-active 'actions.runner.*'
gh api repos/<org>/<repo>/actions/runners --jq '.runners[] | "\(.name) \(.status)"'
```

## NOTES
- `openssl3-libs` puts `libssl.so.3` and `libcrypto.so.3` in `/usr/lib64`, and nothing else on the host needs to change.
- If a host has more than one runner, all of them break at once. Check each unit.
- Reboot outside the hours your scheduled workflows run, and rerun any job that died with "shutdown signal" instead of debugging it.
- Expect the same failure on any distro release that drops OpenSSL 3, until the runner moves to a .NET version that loads OpenSSL 4.
