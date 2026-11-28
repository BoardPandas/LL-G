---
tech: github-actions
tags: [ci, runner-image, openssl, curl, tool-versions, text-output, nextest, no-fail-fast, flaky, xoauth2, oauthbearer]
severity: medium
---
# Tests that assert on a system tool's text output or choices pass locally and fail on the CI image's older version

## PROBLEM
A test shells out to a system tool (`openssl`, `curl`) and asserts on what it prints or on a choice it makes. The developer machine and the CI runner image carry different versions, and the versions differ in exactly those details:

- **OpenSSL 3 and OpenSSL 4 lay out printed text differently.** An assertion on the exact text of a certificate or CMS dump passes on one and fails on the other.
- **curl 8.5 sends OAUTHBEARER even when asked for XOAUTH2.** A test asserting which SASL mechanism reached the server passes with a newer curl and fails with that one.

Because the default test run stops at the first failure, each CI run reveals only one of these, and every fix costs another full run.

## WRONG
```bash
openssl x509 -in cert.pem -noout -text | grep -q '<a line copied from local output>'   # layout-dependent
# and: assert the server saw exactly "AUTH XOAUTH2" from the system curl
cargo nextest run          # stops at the first failing test
```

## RIGHT
```bash
# Compare facts, not layout: ask for one field in a stable form, or parse the artifact in the test itself.
openssl x509 -in cert.pem -noout -fingerprint -sha256
# Assert what must be true for either tool version (authentication succeeded as the expected
# account), not which of two equivalent mechanisms the tool picked.

cargo nextest run --no-fail-fast    # in CI: one run shows every such failure
```

## NOTES
- Print the tool versions at the start of the CI job (`openssl version`, `curl --version`) so a difference is visible in the log.
- If a test truly depends on one tool behaviour, make the test detect the version and state why, rather than fail on the other.
- Related: `fedora-45-ships-only-openssl-4-so-a-self-hosted-actions-runner-dies-on-every.md` on this shelf.
