---
tech: go
tags: [macos, pty, nonblocking, os-file, polling, terminal, deadlines]
severity: high
---
# Setting O_NONBLOCK after constructing an os.File can leave PTY reads outside Go's poller

## PROBLEM
A macOS PTY returned as a blocking os.File was switched to O_NONBLOCK with
unix.SetNonblock(int(file.Fd()), true). The first read returned EAGAIN before the
shell printed its prompt. A conventional read-until-error loop then exited, so
an otherwise live shell displayed a blank terminal. Compilation, vet and tests
using ordinary pipes did not detect it.

## WRONG
```go
master, _ := pty.StartWithSize(cmd, size)
unix.SetNonblock(int(master.Fd()), true)
// Read may return EAGAIN instead of waiting through Go's poller.
n, err := master.Read(buf)
```

## RIGHT
```go
original, err := pty.StartWithSize(cmd, size)
if err != nil { return err }
fd, err := unix.Dup(int(original.Fd()))
original.Close()
if err != nil { return err }
if err := unix.SetNonblock(fd, true); err != nil {
    unix.Close(fd)
    return err
}
master := os.NewFile(uintptr(fd), "terminal")
// Use fd, not master.Fd(), for later ioctls. Fd() switches back to blocking.
err = unix.IoctlSetWinsize(fd, unix.TIOCSWINSZ, size)
```

## NOTES
Construct os.File while its descriptor is already nonblocking so the runtime
can register it with the poller. Retain the descriptor only for synchronized
ioctls and close it through the owning File. Production error paths also kill
and wait for the child process. Drain output through EOF before closing the
master; bound draining with a read deadline in case a descendant keeps the
slave open. Regression coverage should execute native shells, wait for a
prompt before submitting input, resize, interrupt a foreground child, and
assert final output after exit. This was reproduced on macOS arm64, Go 1.27,
with creack/pty 1.1.24 during SupportForge remote-terminal parity work.
