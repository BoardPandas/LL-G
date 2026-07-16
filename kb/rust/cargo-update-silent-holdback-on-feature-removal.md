---
tech: rust
tags: [cargo, cargo-update, feature-flags, dependency-resolution, reqwest, semver, lockfile]
severity: high
---
# cargo update silently holds a crate back when the newer version drops a required feature

## PROBLEM
When a dependency removes a cargo feature you depend on in a later release (even a
patch release, which semver does not forbid for features), `cargo update -p <crate>`
does not error. It prints "Locking 0 packages to latest compatible versions" and keeps
the old version, because the old version is the only one satisfying your feature set.
The project looks fully up to date while it is quietly pinned; you only discover the
real blocker if you force the version with `--precise`, which finally surfaces the
missing-feature error.

Real case (2026-07-16, Hark): reqwest 0.13.1 shipped a `webpki-roots` feature; by
0.13.4 it was gone (replaced by rustls-platform-verifier as the default root store).
`cargo update -p reqwest` silently stayed on 0.13.1 with no hint that the dependency
spec, not the resolver, was the reason.

## WRONG
```bash
# Looks up to date; actually held back with no explanation:
cargo update -p reqwest
#     Locking 0 packages to latest compatible versions
# (assume "we're on the latest" and move on)
```

## RIGHT
```bash
# 1. Ask cargo what it held back and why it might have:
cargo update -p reqwest --verbose
#    Unchanged reqwest v0.13.1 (available: v0.13.4)   <-- "available" = held back

# 2. Force the version to surface the true blocker:
cargo update -p reqwest --precise 0.13.4
# error: package `hark-stt` depends on `reqwest` with feature `webpki-roots`
#        but `reqwest` does not have that feature.
# help: available features: ... rustls, rustls-no-provider, ...

# 3. Now make an informed choice: migrate the feature set (a code/design change,
#    e.g. platform verifier vs. wiring webpki-roots certs into the ClientBuilder)
#    or stay pinned deliberately with a comment in Cargo.toml.
```

## NOTES
- Any "Unchanged X (available: Y)" line in `--verbose` output deserves a `--precise`
  probe; MSRV (rust-version) filtering produces the same silent hold-back and is
  diagnosed the same way.
- Feature removals in patch releases are legal-by-convention and do happen in major
  crates; do not assume a patch bump is safe to skip verifying.
- Related: [reqwest 0.13 renamed the 0.12 TLS umbrella features](reqwest-013-tls-feature-rename.md)
  covers the 0.12 -> 0.13.0/0.13.1 rename that DID error at resolution time; this entry
  covers the later in-0.13.x removal that does not.
