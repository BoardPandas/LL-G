---
tech: linux
tags: [selinux, systemd, 203-exec, fedora, user_home_t, restorecon, permission-denied]
severity: medium
---
# systemd 203/EXEC on unit scripts under /home (SELinux user_home_t)

## PROBLEM
On SELinux-enforcing hosts (Fedora, RHEL), systemd refuses to execute a service's `ExecStart` binary/script that lives under `/home` -- the file carries the `user_home_t` label and the service fails at launch with `status=203/EXEC` and "Permission denied" (which looks like a chmod problem, but the exec bit is set). A second, sneakier variant: `mv`-ing a `.service`/`.timer` unit file into `/etc/systemd/system` PRESERVES the source file's SELinux label, so a unit moved from `/home` keeps `user_home_t` and systemd silently won't load it (`systemctl enable` reports "Unit ... does not exist" even though the file is right there).

## WRONG
```bash
# runner/script installed in the user home dir
sudo tee /etc/systemd/system/myjob.service <<EOF
[Service]
ExecStart=/home/me/app/run.sh   # 203/EXEC: user_home_t not execable by systemd
EOF
mv /home/me/myjob.timer /etc/systemd/system/   # keeps user_home_t label -> won't load
```

## RIGHT
```bash
# Put executables where the default policy labels them bin_t/usr_t:
sudo install -m 0755 run.sh /usr/local/bin/run.sh   # or under /opt/...
# ExecStart=/usr/local/bin/run.sh
# Relabel any unit/script moved into place:
sudo cp myjob.timer /etc/systemd/system/   # or: mv then restorecon
sudo restorecon -v /etc/systemd/system/myjob.timer /usr/local/bin/run.sh
sudo systemctl daemon-reload && sudo systemctl enable --now myjob.timer
```

## NOTES
Diagnose with `journalctl -u <unit>` (shows the 203/EXEC + "Permission denied") and `ls -Z <file>` (shows `user_home_t` vs the expected `bin_t`/`systemd_unit_file_t`). Prefer `cp` over `mv` into system dirs (cp applies the destination's default context via type transition; mv preserves the source label), or always `restorecon` after moving. The GitHub Actions self-hosted runner hits the same wall when installed under `/home` -- relocate it to `/opt`.
