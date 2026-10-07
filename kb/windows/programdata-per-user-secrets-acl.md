---
tech: windows
tags: [programdata, acl, dacl, per-user, sid, named-pipe, go-winio, desktop-agent, multi-session]
severity: high
---
# Per-user secrets in ProgramData are readable by every account, and a pre-planted file survives a DACL fix

## PROBLEM
A desktop agent kept per-person state (contact details, a ticket-portal session token) under
`%ProgramData%\<App>`, keyed by device fingerprint or as one machine-wide file. On a shared PC, a
second Windows account saw the first user's details and inherited their session for up to 24h.

It is not obvious because:
- Per-person state must be keyed by the OS account (SID). The device fingerprint is the wrong key,
  and everything under ProgramData is shared by every account on the machine.
- ProgramData's default inherited ACL grants `BUILTIN\Users` read on files a SYSTEM service writes.
  It also lets Users create subfolders and files, so a standard user can pre-create the target
  directory or file.
- `os.WriteFile` into an existing, pre-planted file keeps its creator's owner and ACL. The creator
  remains owner, has implicit `WRITE_DAC`, and can re-grant themselves read access.

## WRONG
```go
// Machine-wide file; inherits ProgramData's Users:read ACL.
path := filepath.Join(os.Getenv("PROGRAMDATA"), "App", "portal-session.json")
os.MkdirAll(filepath.Dir(path), 0700) // perms are ignored on Windows
os.WriteFile(path, token, 0600)       // reuses any pre-planted file's owner and ACL

// Identifying the pipe caller: the client dialed with anonymous impersonation
// (go-winio DialPipe default), so this yields an anonymous token.
windows.ImpersonateNamedPipeClient(h)
```

## RIGHT
```go
// One file per OS account, in a dir owned by Administrators with a protected SY+BA DACL.
// Taking ownership strips a pre-creator's implicit WRITE_DAC.
sd, _ := windows.SecurityDescriptorFromString("O:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)")
owner, _, _ := sd.Owner()
dacl, _, _ := sd.DACL()
windows.SetNamedSecurityInfo(dir, windows.SE_FILE_OBJECT,
	windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
	owner, nil, dacl, nil)

// Write through a fresh temp file and rename it, so the result inherits the directory's ACL.
tmp, _ := os.CreateTemp(dir, ".session-*")
tmp.Write(data); tmp.Close()
os.Rename(tmp.Name(), filepath.Join(dir, sid+".json"))

// Identify the caller from the client process's own token.
var pid uint32
windows.GetNamedPipeClientProcessId(windows.Handle(conn.(interface{ Fd() uintptr }).Fd()), &pid)
p, _ := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
var tok windows.Token
windows.OpenProcessToken(p, windows.TOKEN_QUERY, &tok)
u, _ := tok.GetTokenUser() // u.User.Sid.String() is the account key
```

## NOTES
- Validate the account string before using it as a filename (`[A-Za-z0-9-]` only), and refuse to
  start a session when the account is unknown. Do not fall back to a shared slot.
- When migrating a legacy shared file by NTFS owner, note that an elevated admin's files are owned by
  `BUILTIN\Administrators` (the token's TokenOwner), not by the user SID. Compare the owner against
  both TokenUser and TokenOwner, or a test running elevated on CI disowns its own temp file.
- On Windows `os/user.Current().Uid` is the SID string, so one unsuffixed Go test can assert the
  resolved peer account on every platform (uid on Linux and macOS via SO_PEERCRED / LOCAL_PEERCRED).
- Per-user data the user's own process writes (not the service) belongs in `os.UserConfigDir()`
  (`%APPDATA%`), which is ACL'd to that user already.
- Seen in SupportForge v3.297.3.0 (commit a29e3e11f).
