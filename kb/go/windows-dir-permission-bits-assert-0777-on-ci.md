---
tech: go
tags: [go, testing, windows, file permissions, acl, ci, os.Stat, filemode]
severity: medium
---
# Permission-bit assertions on directories fail on Windows

## PROBLEM
On Windows, `os.Stat(dir).Mode().Perm()` reports `0777` for every directory regardless of its ACL. A test that asserts a private directory is `0700` passes on Linux and macOS and fails only on the Windows CI job. A Linux-only local run cannot catch it, so the failure appears only after the push.

Permission bits are the wrong oracle for Windows access control. Keep the POSIX-mode assertion on the platforms where it means something, and check the Windows restriction separately against the ACL.

## WRONG
```go
func TestStateDirIsPrivate(t *testing.T) {
	dir := makeStateDir(t)
	info, _ := os.Stat(dir)
	if info.Mode().Perm() != 0o700 {
		t.Fatalf("dir mode %o, want 0700", info.Mode().Perm())
	}
}
```

## RIGHT
```go
func TestStateDirIsPrivate(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX mode bits are not meaningful on Windows; see the ACL test")
	}
	dir := makeStateDir(t)
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o700 {
		t.Fatalf("dir mode %o, want 0700", info.Mode().Perm())
	}
}
```

## NOTES
- Test the Windows restriction in its own test that reads the DACL (for example through `GetNamedSecurityInfo`), and run it on the Windows job rather than skipping it there.
- A `_ =` on the `os.Stat` error turns a missing directory into a nil dereference. Check the error.
