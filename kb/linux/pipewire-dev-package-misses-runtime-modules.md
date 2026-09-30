---
tech: linux
tags: [pipewire, debian, ubuntu, apt, runtime-dependencies, github-actions, rust, ci, release]
severity: medium
---
# PipeWire development packages can leave runtime modules missing in minimal CI images

## PROBLEM

Installing `libpipewire-0.3-dev` is enough to compile a PipeWire client, but it
does not establish that the runtime modules needed by the client's configuration
are installed. On a minimal Debian/Ubuntu runner using
`apt-get install --no-install-recommends`, a Rust test can build successfully and
then fail at `pipewire::context::ContextRc::new(...)` with `CreationFailed`.

The missing component in the observed failure was
`libpipewire-module-protocol-native`. The test configured that module explicitly
and used a Unix socket pair; it needed neither a running PipeWire daemon nor
audio hardware. Those properties do not remove the runtime module requirement.
The Rust error alone did not name the missing module; `PIPEWIRE_DEBUG=2` did.

This is easy to miss when the regular CI job installs the runtime module package
but the release job has a separate, smaller dependency list. A green branch CI
run does not establish that tests will pass in the release environment.

## WRONG

```bash
# Debian/Ubuntu: headers and link metadata do not prove context creation works.
sudo apt-get update
sudo apt-get install -y --no-install-recommends libpipewire-0.3-dev
cargo test -p hark-audio discovery_timeout_and_disconnect_exit_the_real_pipewire_loop

# Do not fix the resulting CreationFailed by skipping the test or assuming
# that a daemon-free test has no runtime module dependencies.
```

## RIGHT

```bash
# Debian/Ubuntu jobs that execute this PipeWire context test need both packages.
# Keep the rest of the project's build dependencies in the install list too.
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  libpipewire-0.3-dev libpipewire-0.3-modules

# Retain the real initialization test in CI and release verification.
cargo test -p hark-audio discovery_timeout_and_disconnect_exit_the_real_pipewire_loop

# When diagnosing context creation, reveal the underlying loader error.
PIPEWIRE_DEBUG=2 cargo test -p hark-audio \
  discovery_timeout_and_disconnect_exit_the_real_pipewire_loop -- --nocapture
```

## NOTES

- Scope these apt package names to Debian/Ubuntu. Fedora and Arch split and name
  packages differently; identify the package that supplies the required module
  on the actual target distribution. See
  [Debian package names do not exist on Arch](arch-debian-package-names.md).
- A controlled reproduction can point `PIPEWIRE_MODULE_DIR` at an empty
  temporary directory for one test process. In the observed Hark case, that
  reproduced `CreationFailed` and the missing protocol-native module diagnostic;
  running the same test with the default installed module path passed. No system
  packages were removed, and no daemon or audio device was needed for this test.
  This does not establish that arbitrary PipeWire operations are daemon-free.
- Keep runtime dependencies explicit in every CI/release environment that
  executes the relevant code. Preserve the failing test rather than lowering the
  gate. See [release workflows need their own verification](../github-actions/release-workflow-not-gated-on-ci.md).
- Observed in [Hark release run 36771797308](https://github.com/BoardPandas/Hark/actions/runs/36771797308)
  on 2026-09-30. The [0.61.3 dependency fix](https://github.com/BoardPandas/Hark/commit/8dea8efd7115283120f91b9a0a3381524ab44941)
  explicitly installs the runtime module package. Local Linux verification
  reported 1,151 workspace tests passed, zero failed, and one ignored; this is
  not a claim that the hosted release workflow or publication completed.
