---
tech: claude-code
tags: [sandbox, bash, build, pkg-config, false-conclusion, verification]
severity: high
---
# A sandboxed Bash failure imitates a missing system dependency, and the wrong conclusion outlives it

## PROBLEM
Claude Code may run Bash commands sandboxed. A sandboxed command can fail to reach parts of the filesystem or environment that are genuinely present, and build tooling reports that as a missing-dependency error — worded exactly like the real thing, complete with a helpful install hint.

Observed: the first `cargo test` in a session failed inside a build script with

```
Package alsa was not found in the pkg-config search path.
The system library `alsa` required by crate `alsa-sys` was not found.
HINT: if you have installed the library, try setting PKG_CONFIG_PATH ...
```

`/usr/include/alsa/asoundlib.h` and `/usr/lib64/pkgconfig/alsa.pc` were both present the whole time. Re-running the same command later (unsandboxed) compiled in 4.5 seconds.

The damage is not the failed command — it is what gets built on top of it. The false conclusion ("this crate cannot compile on this machine") was stated to the user twice, used to justify shipping a diagnosis as unverified, and written into a plan document's permanent Lessons Learned section, where it would have told every future session not to bother trying. An environment claim is load-bearing: everything downstream inherits its correctness.

The same shape applies to any sandbox-sensitive probe — network reachability, missing binaries on `PATH`, permission-denied on a readable file, absent env vars.

## WRONG
```bash
cargo test -p my-crate
# error: `alsa` not found ... "The system library required by crate was not found"

# Conclusion recorded in the plan and reported to the user:
#   "This crate cannot build on Linux without ALSA dev headers.
#    Verification is impossible here; everything below is unverified."
# -> every later claim in the session is now hedged on a false premise.
```

## RIGHT
```bash
# Before concluding the environment lacks something, verify the claim directly.
ls /usr/include/alsa/asoundlib.h            # header actually present?
pkg-config --libs --cflags alsa             # does the probe work standalone?
#  -lasound                                 <- it does; the failure was the sandbox

cargo test -p my-crate                      # retry: compiles in seconds
```

## NOTES
- **A tooling failure that blocks verification deserves one retry outside the environment you first hit it in**, precisely because believing it makes every later claim unverifiable. Cheap to check, expensive to get wrong.
- **Check the artifact, not the error message.** The error is a build script's *interpretation* of a failed probe. `ls` the header, run the probe standalone, `command -v` the binary. One read-only command distinguishes "absent" from "unreachable".
- **Retract loudly.** If a false environment claim already reached the user or a document, correct it explicitly rather than quietly moving on — a stale "cannot build here" note in a plan is an instruction to future sessions not to try.
- Prefer `dangerouslyDisableSandbox` only after the direct checks show the dependency is genuinely present and the sandbox is the difference; do not reach for it as a first response to any failing build.
