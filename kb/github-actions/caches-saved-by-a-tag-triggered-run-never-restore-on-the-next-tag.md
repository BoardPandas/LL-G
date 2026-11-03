---
tech: github-actions
tags: [cache, rust-cache, tags, release, actions-cache, rust, supply-chain]
severity: high
---
# Caches saved by a tag-triggered run never restore on the next tag

## PROBLEM
A cache saved by a tag-triggered workflow run is scoped to that tag's ref, so the next tag can never restore it. Every release therefore compiles from zero and still pays to upload a cache that nothing will ever read.

This is not obvious because nothing fails. The cache step succeeds, and the post-job save succeeds too. A run can restore only caches from its own ref and from the default branch. In one Rust release workflow, every `Swatinem/rust-cache` step logged `No cache found.` on every release. The jobs then spent up to 2 minutes each saving about 4.7 GB per release. That pushed the repository past its 10 GB cache quota, so GitHub began evicting the default branch's CI caches as well. The entries show in `gh cache list` with a ref like `refs/heads/refs/tags/v1.2.3`.

## WRONG
```yaml
on:
  push:
    tags: ["v*"]
jobs:
  build:
    steps:
      - uses: Swatinem/rust-cache@<sha>
        with:
          key: release-linux   # saved under refs/tags/vX; the next tag cannot read it
      - run: cargo test --workspace
      - run: cargo build --release
```

## RIGHT
```yaml
# ci.yml, on push to main: the only writer
      - uses: Swatinem/rust-cache@<sha>
        with:
          shared-key: rust-checks   # shared-key drops the job id from the key

# release.yml, check job only (no shipped artifact, no secrets, no write token)
      - uses: Swatinem/rust-cache@<sha>
        with:
          shared-key: rust-checks
          save-if: false            # tag runs read main's cache and never save

# release.yml, build job for the shipped/signed binary: no cache at all
      - run: cargo build --release -p app
```

## NOTES
- To share a cache, both workflows must compute the same key. With rust-cache, `key:` appends the job id. Use `shared-key:` on both sides; the runner OS and arch are still added, so platform legs stay separate.
- Restore main's cache only in jobs that produce nothing shipped and hold no secrets. Any workflow that runs on main can write main's cache, so a signed build that restores it trusts all of them. Keep the shipped build uncached and pass its binary to the signing job as an artifact.
- Check for the problem in two places: the run logs (`No cache found.` on every tag) and `gh cache list` (entries on tag refs).
- A version bump changes `Cargo.lock`, so the exact key misses on a tag. rust-cache still restores from its prefix key.
