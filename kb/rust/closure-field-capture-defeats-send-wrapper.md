---
tech: rust
tags: [closures, edition-2021, send, threads, windows, handle, ffi, cross-compile]
severity: medium
---
# Edition 2021 captures closure fields, so destructuring a Send newtype in the closure defeats the wrapper

## PROBLEM

The standard way to move a non-`Send` FFI handle (a Win32 `HANDLE`, an
`HWND`, a raw pointer) into a thread is a newtype with an `unsafe impl Send`.
The wrapper is correct, but edition 2021's *disjoint closure capture* decides
what to capture by looking at the **paths the closure body uses**, not at the
variable as a whole. A body that destructures the wrapper — `let Wrapper(h) =
w;` — only ever names `w.0`, so the closure captures the bare inner field and
the `unsafe impl Send` on the outer type never applies.

The compiler then rejects the spawn with an error about the *inner* type
(`*mut c_void cannot be sent between threads safely`), pointing at the closure
rather than at the destructuring line, while the wrapper sitting right above it
looks exactly like every "how to send a HANDLE to a thread" example. It reads
as though the `unsafe impl Send` were ignored.

The trap compounds when the handle type is platform-gated. On a Linux or macOS
dev loop the `#[cfg(windows)]` module is never compiled, so `cargo check`,
`clippy`, and the full test suite all pass; the error appears only in the
Windows release build. Cross-check platform-specific modules with
`cargo check --target x86_64-pc-windows-msvc` (no MSVC toolchain needed as long
as the crate has no C build dependencies — `cargo check` does not link).

## WRONG

```rust
struct SendHandle(HANDLE);
unsafe impl Send for SendHandle {}

let thread_event = SendHandle(event);
std::thread::spawn(move || {
    // Captures `thread_event.0` (a bare HANDLE), NOT `thread_event`.
    // error[E0277]: `*mut c_void` cannot be sent between threads safely
    let SendHandle(event) = thread_event;
    loop {
        unsafe { WaitForSingleObject(event, INFINITE) };
    }
});
```

## RIGHT

```rust
struct SendHandle(HANDLE);
unsafe impl Send for SendHandle {}

impl SendHandle {
    fn get(&self) -> HANDLE {
        self.0
    }
}

let thread_event = SendHandle(event);
std::thread::spawn(move || {
    // A method call names the whole struct, so the closure captures
    // `thread_event` and picks up its Send impl.
    let event = thread_event.get();
    loop {
        unsafe { WaitForSingleObject(event, INFINITE) };
    }
});
```

## NOTES

- A method call is the readable fix, but any use that names the whole binding
  works: `let thread_event = thread_event;` as the closure's first statement
  forces a whole-struct capture too (this is what the edition guide calls the
  "insert a dummy let" workaround). Prefer the method — the intent survives a
  later edit, where a stray `let` invites deletion as dead code.
- The same rule bites the other direction and is worth knowing generally: a
  closure that touches only one field of a large captured struct no longer
  holds the rest alive. That is usually the point of the feature, but it also
  means auto-trait behavior (`Send`, `Sync`, `UnwindSafe`) is decided
  per-captured-path, not per-variable.
- Edition 2018 and earlier capture whole variables, so this compiles there.
  Code moved forward across an edition bump can start failing for this reason
  alone.
- Reference: Rust Edition Guide, "Disjoint capture in closures" (RFC 2229).
