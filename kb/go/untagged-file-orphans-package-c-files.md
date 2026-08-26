---
tech: go
tags: [build-constraints, cgo, cross-compile, build-tags, platform-specific, testing]
severity: medium
---
# Making one file untagged builds the package on every GOOS, and orphans its C files

## PROBLEM

The standard fix for "this helper's test only runs on one platform" is to move the
pure logic into an **untagged** file. That fix is correct, and in a package that
also contains `.c`/`.h` files it breaks every other platform's build.

A package whose Go files all carry `//go:build linux` does not exist off Linux.
`go build ./...` skips it in silence, and the go command never looks at its C
files. Add **one** untagged `.go` file and the package becomes buildable
everywhere -- and now its `.c`/`.h` files are considered on those platforms too.

What happens next depends on cgo, in a way that hides the damage:

- `CGO_ENABLED=0` -- C files are *ignored outright*. No error.
- `CGO_ENABLED=1` with a selected Go file importing `"C"` -- normal cgo build. No error.
- `CGO_ENABLED=1` with **no** selected Go file importing `"C"` -- hard error:
  `C source files not allowed when not using cgo or SWIG: pipewire.c`

That third row is macOS by default, and Windows on any machine with a C compiler
installed. The untagged Go file you just added does not import `"C"`, so on those
hosts the package now consists of your one new file plus an orphaned `.c`.

The trap is the verification. The bug that sent you here is almost always found
by a cgo-free cross-compile check, so that is the command you re-run to confirm
the fix -- and row 1 says it passes. You see green on the exact command from the
report and have broken every developer's Mac. The error, when someone finally
hits it, names a C file you never touched, in a package where you only moved a Go
function between two files.

`gofmt` and `go vet` on the fixed target stay clean throughout.

## WRONG

```go
// x11.go
//go:build linux && cgo

func clampToRoot(m Monitor, rootW, rootH int) (Monitor, error) { /* pure arithmetic */ }

// capture_test.go
//go:build linux
//   -> GOOS=linux CGO_ENABLED=0 go vet ./internal/linuxcapture
//      vet: capture_test.go:110:16: undefined: clampToRoot

// The fix: move clampToRoot (and the Monitor type it takes) to an untagged
// geometry.go so the test runs everywhere. Correct, and incomplete --
// pipewire.c and pipewire.h in the same directory still carry no constraint:
//
//   $ GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go vet ./internal/linuxcapture
//   (passes -- a cgo-disabled build ignores .c files)
//
//   $ go vet ./internal/linuxcapture            # macOS, CGO_ENABLED=1
//   C source files not allowed when not using cgo or SWIG: pipewire.c
```

## RIGHT

```c
// pipewire.c AND pipewire.h -- the same constraint the cgo Go files carry.
// Build constraints are honoured in .c/.h/.s, not only .go.
//go:build linux && cgo

// (blank line required after the constraint, before any code)
#ifndef SUPPORTFORGE_PIPEWIRE_H
```

```go
// Then prove the package on the platforms it now reaches, not just the one
// named in the bug report:
//
//   GOOS=linux   GOARCH=amd64 CGO_ENABLED=0 go vet ./internal/linuxcapture
//   GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./internal/linuxcapture
//   go vet ./internal/linuxcapture && go test ./internal/linuxcapture   # host, cgo on
//
// And confirm the cgo path still selects everything it used to -- go list
// parses without needing a C compiler, so this works from any machine:
//
//   GOOS=linux CGO_ENABLED=1 go list -f '{{.CgoFiles}} {{.CFiles}} {{.TestGoFiles}}' ./...
```

## NOTES

Companion to [goos-filename-suffix-makes-tests-unrunnable.md](goos-filename-suffix-makes-tests-unrunnable.md):
that entry tells you to move pure logic into an un-suffixed file; this is the bill
that arrives when the package also holds C.

- An exported type in the moved function's signature has to move with it. A lone
  untagged `geometry.go` referring to a `Monitor` declared in a `linux`-tagged
  file is undefined everywhere else, so the type migrates too -- widening the
  package's cross-platform API surface as a side effect of a test-coverage fix.
- The filename suffix will not carry this constraint. `pipewire_linux.c` still
  gets selected under `GOOS=linux CGO_ENABLED=0`, where it is again an orphan;
  cgo is not expressible as a filename suffix, so it must be a `//go:build` line.
- Check for an existing precedent in the repo before inventing one -- a
  cross-platform package that already ships platform C (`userclipboard_darwin.m`
  carrying `//go:build darwin && cgo`) has solved this, and matching it is
  cheaper than rediscovering it.
- Seen live: `internal/linuxcapture` in a Go/Wails desktop agent. `clampToRoot`
  was `linux && cgo`, its test was `linux`, and CI never noticed because CI builds
  Linux with cgo on. Moving the function out fixed the reported command and made
  `go build ./...` fail on macOS until `pipewire.c` and `pipewire.h` were
  constrained too.
