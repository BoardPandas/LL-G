---
tech: go
tags: [macos, credentials, setgroups, initgroups, sudo, service, impersonation]
severity: high
---
# macOS directory group membership can exceed the setgroups limit

## PROBLEM
A root service prepared an exec.Cmd for a selected account using os/user.GroupIds
as syscall.Credential.Groups. Native tests under an ordinary user passed because
they did not switch credentials. The identical test under root failed before
exec with EINVAL: the returned directory memberships exceeded macOS's native
supplementary-group limit. Even selecting root itself failed. Silently truncating
the list changes authorization semantics and is not an equivalent identity.

## WRONG
```go
groups, _ := selected.GroupIds()
cmd.SysProcAttr = &syscall.SysProcAttr{
    Credential: &syscall.Credential{Uid: uid, Gid: gid, Groups: allGroupIDs(groups)},
}
```

## RIGHT
For a root macOS service, use an OS account-switching primitive that performs
native initgroups and directory membership setup. For example, invoke the
system sudo binary non-interactively with an exact numeric account and an
argument vector, never shell interpolation:

```go
args := append([]string{"/usr/bin/sudo", "-n", "-H", "-u", "#"+uid,
    "--", cmd.Path}, cmd.Args[1:]...)
cmd.Path, cmd.Args = "/usr/bin/sudo", args
```

## NOTES
Only use this wrapper when the parent is already root and must switch accounts.
Keep the service account unchanged when that is the selected identity. Resolve
the active console owner explicitly, refuse UID 0 for logged-in-user mode, and
fail if the switch fails. Set the selected home directory and a sanitized
environment before launch, without service secrets or inherited startup hooks.
Verify actual id -u output against the reported account in BOTH user-run and
root-run tests. Test the actual PTY/provider path too. These operations provide
account identity, not an authorization bypass or permission to execute work.
