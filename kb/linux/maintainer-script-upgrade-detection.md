---
tech: linux
tags: [packaging, deb, rpm, pacman, dpkg, maintainer-scripts, systemd, nfpm, upgrade]
severity: high
---
# dpkg, rpm and pacman each signal "this is an upgrade" differently, and guessing disables the service on the two you did not test

## PROBLEM

A package that owns a systemd unit has to stop the service before its files are
removed, and must **not** disable it when the removal is half of an upgrade --
the post-install will start it again, but only if it is still enabled.
Distinguishing the two is the maintainer script's job, and the three package
managers do it in three incompatible ways:

| Manager | Hook | Upgrade | Removal |
|---|---|---|---|
| dpkg | `prerm` | `$1 == "upgrade"` | `$1 == "remove"` |
| rpm | `%preun` | `$1 == 1` (packages that will remain) | `$1 == 0` |
| pacman | `pre_remove` | **not called at all** (`pre_upgrade` is) | called |

Note that rpm's numbers are the *opposite* of the intuitive reading: `1` means
an upgrade is in progress, `0` means the last copy is going away. A script that
tests `[ "$1" = "0" ]` for "is an upgrade" is exactly backwards, and a script
that tests `[ -n "$1" ]` treats every rpm removal as an upgrade.

What makes this a HIGH rather than an obvious bug is how it fails. Write and
test the script on Debian, and it is correct there. Ship it, and:

- On **rpm** systems, `$1` is `1` during an upgrade, which does not equal the
  string `upgrade`, so the script takes the removal branch and runs
  `systemctl disable`. The upgrade completes successfully. The service is
  installed, the files are current, `rpm -q` reports the new version -- and it
  is switched off and will not come back on reboot.
- On **pacman**, `pre_remove` is never invoked on an upgrade, so an
  upgrade-detection bug there is invisible; but a script that puts its *stop*
  logic only in `pre_remove` never stops the old daemon, and the new files are
  installed underneath a running process.

Nothing errors. The package manager reports success, the exit status is 0, and
the fleet goes quiet one distro family at a time. For a monitoring or support
agent this is the worst possible failure: the machines that stop reporting are
indistinguishable from machines that are switched off.

## WRONG

```sh
#!/bin/sh
# prerm / %preun / pre_remove -- one script, three package managers.
# Correct on Debian. Disables the service on every rpm-based system.
set -e

if [ "$1" = "upgrade" ]; then
    IS_UPGRADE=1
else
    IS_UPGRADE=0        # rpm passes "1" here during an upgrade -> lands here
fi

systemctl stop myagent.service || true
if [ "$IS_UPGRADE" = "0" ]; then
    systemctl disable myagent.service || true   # runs on every rpm upgrade
fi
```

Also wrong, in the other direction:

```sh
# "Any argument means an upgrade" -- treats every rpm *removal* as an upgrade,
# so an uninstalled package leaves an enabled unit pointing at deleted files
# and systemd logs a 203/EXEC on every boot.
[ -n "$1" ] && IS_UPGRADE=1 || IS_UPGRADE=0
```

## RIGHT

```sh
#!/bin/sh
# Pre-remove. Runs before the files go, on remove AND on the remove half of an
# upgrade.
#
#   dpkg    -- $1 is "upgrade" or "remove"
#   rpm     -- $1 is the number of packages that will REMAIN: 1 = upgrade, 0 = remove
#   pacman  -- pre_remove is not called during an upgrade at all
#
# Matching both forms in one case statement covers all three: pacman simply
# never reaches this script on an upgrade, which is the correct behaviour by
# omission.
set -e

IS_UPGRADE=0
case "$1" in
    upgrade|1) IS_UPGRADE=1 ;;
esac

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    # Stopping is unconditional: the files are about to be replaced or removed
    # either way, and a running process holding the old binary is wrong in both.
    systemctl stop myagent.service 2>/dev/null || true

    # Disabling is NOT. On an upgrade the post-install re-enables and restarts,
    # but only for a unit that is still enabled.
    if [ "$IS_UPGRADE" = "0" ]; then
        systemctl disable myagent.service 2>/dev/null || true
    fi
fi

exit 0
```

```sh
#!/bin/sh
# Post-install. Runs on install AND on upgrade, on all three formats, so every
# command must be idempotent.
set -e

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    systemctl daemon-reload || true

    # enable --now covers both cases: a fresh install starts it, and an upgrade
    # where it is already enabled is a no-op.
    systemctl enable --now myagent.service || true

    # try-restart, not restart: restarts only a unit that is already running,
    # so a deliberately stopped service stays stopped. Without this an upgrade
    # leaves the OLD binary running until the machine next reboots -- which on
    # a long-lived endpoint means an urgent fix does not actually ship.
    systemctl try-restart myagent.service || true
fi

exit 0
```

## NOTES

- Write maintainer scripts in **`/bin/sh`, not bash**. rpm and pacman scriptlets
  run under the system shell, which on a minimal image is dash. A bashism
  (`[[ ]]`, arrays, `local` outside a function) fails on exactly the distros
  least likely to be hand-tested. Gate it in CI with `sh -n script.sh`.
- Guard every systemd call on `command -v systemctl` **and** `[ -d
  /run/systemd/system ]`. The second is what distinguishes "systemd is
  installed" from "we are running under it" -- a container or chroot build has
  the binary and no PID 1, and `systemctl` there fails the whole install.
- With `nfpm` all three formats share one `scripts.preremove`, which is what
  makes this trap so easy to fall into: one file, three calling conventions,
  and only one of them exercised on your machine.
- pacman's hooks are `pre_install` / `post_install` / `pre_upgrade` /
  `post_upgrade` / `pre_remove` / `post_remove` in a `.INSTALL` file. nfpm maps
  its `preremove` to `pre_remove` and its `postinstall` to **both**
  `post_install` and `post_upgrade`, which is why the post-install above must
  be idempotent rather than assuming a first install.
- Do **not** delete `/etc/<yourapp>` in `postremove`. Enrolment tokens and
  device identity live there, and removing them means a reinstall enrols as a
  new device with the history attached to the old record -- and reinstalling to
  fix something is the most common repair anyone performs. `apt purge` removes
  it, which is the explicit request.
