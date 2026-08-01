---
tech: github-actions
tags: [ci, release, gating, workflow_run, tags, signing, supply-chain]
severity: high
---
# A release workflow independent of CI publishes signed artifacts while CI is red

## PROBLEM

The common split -- `ci.yml` on push/PR, `release.yml` on `v*` tags -- creates two
workflows that never consult each other. The release job builds, signs, and
publishes whatever the tag points at, with no idea the test suite is failing on
that exact commit. Nothing surfaces the gap: the release run is green, the
artifact is signed, the GitHub release is real. The only red mark is on a
different workflow that nobody looks at during a release.

This is not a theoretical hole. In one repo a stale platform-specific test
failed CI on every push across four consecutive versions, and all four Release
runs published signed installers during that window. The releases were green the
whole time.

The trap when fixing it is reaching for `workflow_run` or a `gh api` query on
the tagged SHA. Both look like the "proper" cross-workflow gate and both fail
here:

- **CI usually has no tag trigger.** Often deliberately -- adding one changes the
  OIDC subject claim and breaks Azure signing (see
  `tag-trigger-breaks-azure-oidc.md`). So no CI run exists *on the tag*, and
  `workflow_run: workflows: [CI], types: [completed]` never fires for it.
- **`workflow_run` runs in default-branch context.** `github.ref` is
  `refs/heads/main`, not the tag. Any tag-derived logic in the release job --
  version resolution, asset naming, the tag passed to the release action -- has
  nothing to read.
- **Querying CI's conclusion for the tagged SHA races the push.** Commit and tag
  are typically pushed together, so both workflows start within the same second.
  The release must poll for a verdict that does not exist yet.
- **"No CI run for this SHA" has no safe answer.** Fail it and you block
  `workflow_dispatch` re-releases of older tags. Pass it and the gate is
  decorative -- exactly the hole you set out to close.

## WRONG

```yaml
# ci.yml -- runs the checks, on a completely separate trigger
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    steps:
      - run: cargo clippy --all-targets -- -D warnings
      - run: cargo test --workspace

# release.yml -- builds and ships, consults nothing
on:
  push: { tags: ["v*"] }
jobs:
  release:
    steps:
      - run: cargo build --release        # red CI? ships anyway
      - uses: Azure/artifact-signing-action@v2
      - uses: softprops/action-gh-release@v3
```

Also wrong -- the cross-workflow gate that cannot fire, because CI never ran on
the tag and this job no longer knows what tag it is releasing:

```yaml
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
jobs:
  release:
    if: github.event.workflow_run.conclusion == 'success'
    steps:
      # github.ref is refs/heads/main here -- the tag is gone
      - run: echo "releasing ${{ github.ref_name }}"   # prints "main"
```

## RIGHT

Run the checks inside the release job, before the build and before any signing
step. It verifies the exact tree about to be shipped, with no second workflow to
race and no external state to query.

```yaml
# release.yml
on:
  push: { tags: ["v*"] }
jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v7
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2

      # THE GATE: duplicates ci.yml on purpose. Placed before the build so a bad
      # tree never reaches signing and never spends signing quota.
      - run: cargo fmt --all -- --check
      - run: cargo clippy --all-targets -- -D warnings
      - run: cargo test --workspace

      - run: cargo build --release
      - uses: Azure/artifact-signing-action@v2
      - uses: softprops/action-gh-release@v3
```

## NOTES

- **Duplication is the point.** "CI already ran this" is the reasoning that
  leaves the gate open. A release that cannot verify itself is not gated; it is
  gated on a human remembering to look at another tab.
- **Order matters.** Put the checks ahead of the signing steps, not merely ahead
  of publishing. A failed build after signing has already consumed signing
  service quota, and on some services that is metered or rate-limited.
- **Watch the profile.** If your checks build test binaries, keep them in the
  debug/default profile. Running `--all-targets` under `--release` drops test
  executables into `target/release`, which a signing step that globs that folder
  will happily sign and ship alongside the real binary.
- **Know the scope you bought.** The gate only covers the platforms the release
  runner uses. A Windows-only release job will not catch a macOS-only test
  failure -- that stays CI's job. This is usually the correct split (the artifact
  is Windows), but state it in a comment so nobody assumes total coverage.
- Related: `tag-trigger-breaks-azure-oidc.md` explains why adding a tag trigger
  to CI -- the other obvious "fix" -- is itself a trap.
