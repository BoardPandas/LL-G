---
tech: go
tags: [go, windows, testing, staging, permissions, isolation]
severity: medium
---
# Fake installers still reach production staging unless tests override the directory

## PROBLEM

A service provider has fake installer, inventory and artifact-fetch interfaces, so its
orchestration tests appear isolated. But the default staging directory is still real.
On Windows, the default may be a protected ProgramData directory whose ACL grants only
LocalSystem and Administrators. An ordinary developer's test fails before reaching the
fake installer. Tests for post-detection, recovery and timeout reporting then all fail
with misleading outcome mismatches. An elevated test can instead change the live staging
directory's ACL because hardening runs on every staging attempt.

## WRONG

```go
provider := &Provider{
    Installer: fakeInstaller,
    Inventory: fakeInventory,
    Fetcher: fakeFetcher,
    // Empty TempDir reaches the service's real staging directory.
}
```

## RIGHT

```go
provider := &Provider{
    Installer: fakeInstaller,
    Inventory: fakeInventory,
    Fetcher: fakeFetcher,
    TempDir: t.TempDir(),
}
```

Use the existing per-instance staging seam rather than weakening production ACLs,
changing ProgramData globally, or requiring the unit suite to run elevated. During the
fake install, read the file and assert exact bytes, expected extension and containment
under the test directory; after orchestration returns, assert the staged file is gone.

## NOTES

Found by running SupportForge software orchestration tests natively on Windows. Nine
tests failed before the fake installer ran. Assigning test-owned staging restored the
intended coverage without any production code change. This proves orchestration and
file lifecycle, not the production ACL or a real installer under LocalSystem; those
need a separate Windows integration test.
