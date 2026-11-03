---
tech: github-actions
tags: [glibc, ubuntu-latest, runner-images, linux, release, deb, rpm, dpkg-shlibdeps]
severity: high
---
# A ubuntu-latest label migration silently raises the glibc floor of a binary built on it

## PROBLEM
A dynamically linked Linux release binary built on `ubuntu-latest` requires at least that runner's glibc, so when GitHub moves `ubuntu-latest` to a newer Ubuntu (24.04 -> 26.04 in November 2026) the shipped binary stops running on older distros with no change in the repo.
Nothing fails in CI: the build, tests and packaging all pass on the new image. Users on Ubuntu 24.04 LTS or Debian 13 then get `GLIBC_2.xx not found` at launch. `dpkg-shlibdeps` also derives `.deb` Depends versions from the build host, so the package can refuse to install too. Updating "all runners to latest" in one sweep makes the same change deliberately but just as invisibly.

## WRONG
```yaml
linux-build:
  runs-on: ubuntu-latest   # floats; glibc floor moves with it
  steps:
    - run: cargo build --release
    - run: cargo deb --no-build
```

## RIGHT
```yaml
# GLIBC FLOOR: the binary needs >= the build runner's glibc (2.39 on 24.04:
# Ubuntu 24.04+, Debian 13+, Fedora 40+). Move it deliberately, together with
# the documented requirement.
linux-build:
  runs-on: ubuntu-24.04    # pinned on purpose; test jobs can use ubuntu-26.04
```

## NOTES
Pin only the job that produces the shipped artifact; check/test jobs can track the newest image. Verify with `objdump -T <binary> | grep GLIBC_ | sort -V | tail -1`. Watch actions/runner-images "Announcement" issues for `-latest` migrations. Older images retire on a schedule, so a pin is a dated decision, not permanent; an older-glibc build container (or musl/static linking) is the alternative to widen the floor.
