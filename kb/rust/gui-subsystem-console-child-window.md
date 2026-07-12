---
tech: rust
tags: [windows, subsystem, create-no-window, process, tokio, console, focus-stealing, conpty]
severity: high
---
# GUI-subsystem parent spawns visible console windows for every console child

## PROBLEM
A binary built for the Windows GUI subsystem (`#![windows_subsystem = "windows"]`,
or linked `/SUBSYSTEM:WINDOWS`) has no console of its own. When such a process
spawns a console-subsystem child (`git.exe`, `where.exe`, `taskkill.exe`, `cmd.exe`,
most CLI tools), Windows allocates a brand-new console window for that child.

If the spawn is on a poll loop (e.g. a status-bar git poller running `git` every
5 seconds), a console window flashes on screen on every tick. Worse, each new
console window grabs the foreground, so it steals keyboard focus from the GUI app.
The visible symptom is bizarre and disconnected from the cause: "I can't type into
the app" plus a window that flickers open and closed. Nothing in the input/keyboard
code is wrong. The regression is almost always a subsystem switch: while the app was
a console binary, console children inherited the parent console and nothing flashed;
flipping it to GUI-subsystem silently broke every console-child spawn at once.

PTY-hosted children are NOT affected: they run inside a ConPTY pseudoconsole, which
is not a real window, so they never flash regardless of the parent's subsystem.

## WRONG
```rust
// GUI-subsystem app polling git every few seconds.
// Each call pops a console window and steals focus.
let output = tokio::process::Command::new("git")
    .args(["rev-parse", "--abbrev-ref", "HEAD"])
    .current_dir(cwd)
    .output()
    .await?;

// std::process::Command has the same problem:
Command::new("taskkill").args(["/PID", &pid, "/T", "/F"]).spawn()?;
```

## RIGHT
```rust
// CREATE_NO_WINDOW = 0x0800_0000 suppresses the console window.

// tokio::process::Command has an inherent creation_flags method on Windows:
let mut command = tokio::process::Command::new("git");
command.args(["rev-parse", "--abbrev-ref", "HEAD"]).current_dir(cwd);
#[cfg(windows)]
command.creation_flags(0x0800_0000);
let output = command.output().await?;

// std::process::Command needs the CommandExt extension trait:
#[cfg(windows)]
{
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
}
```

## NOTES
- Apply the flag to EVERY background console child, not just the loop one: a
  one-shot `where`/`which` availability check or a `taskkill` on exit will each
  flash a window too, just less often.
- `CREATE_NO_WINDOW` (0x0800_0000) is what you want here. Do not reach for
  `DETACHED_PROCESS` (0x0000_0008) or `CREATE_NEW_CONSOLE` (0x0000_0010); the
  former detaches stdio you may still want to capture, the latter still creates
  a window.
- Real-world regression: PandaMUX commit 526701e switched `pandamux.exe` from a
  console-subsystem to a GUI-subsystem binary; the fix added `creation_flags` to
  the git poller (`pollers.rs`), the shell-availability check (`shell.rs`), and
  the tree-kill (`session.rs`).
- Related: [Blocking std::fs calls on Tokio runtime](blocking-io-on-tokio.md) is
  the other easy way to make a Windows GUI Rust app misbehave under a poll loop.
