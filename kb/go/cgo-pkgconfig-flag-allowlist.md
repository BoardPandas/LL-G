---
tech: go
tags: [cgo, pkg-config, CGO_CFLAGS_ALLOW, CGO_LDFLAGS_ALLOW, pipewire, build, security]
severity: medium
---
# cgo silently refuses pkg-config flags it does not recognise, and the error names the flag rather than the fix

## PROBLEM

cgo runs every compiler and linker flag through an **allowlist** before passing
it to the toolchain (`cmd/go/internal/work/security.go`). This is a deliberate
defence: a malicious or compromised `.pc` file could otherwise inject
`-fplugin=`, `-B`, or `@file` and get arbitrary code execution at build time.

The problem is that the allowlist is a fixed pattern list, and perfectly
ordinary flags shipped by well-known libraries are not on it. When a package
uses `#cgo pkg-config:` and the library's `.pc` file emits one of them, the
build fails with:

```
invalid flag in pkg-config --cflags: -fno-strict-overflow
```

That message names the flag but not the remedy, and the remedy is not
discoverable from it. Three things make this cost more time than it should:

1. **It is not your flag.** You never wrote `-fno-strict-overflow` -- libpipewire's
   `.pc` file did. Searching your own source for it finds nothing, and the
   obvious reading is that the library is broken or the wrong version.
2. **It looks like a missing dependency.** "invalid flag in pkg-config" reads
   like pkg-config failed, so the first instinct is to check that the `-dev`
   package is installed and that `PKG_CONFIG_PATH` is right. Both are fine.
3. **`go vet`, `gopls` and the editor are unaffected** until they actually try
   to build the cgo package, so it appears at `go build` time on CI rather than
   while writing the code.

The fix is `CGO_CFLAGS_ALLOW` (or `CGO_LDFLAGS_ALLOW` / `CGO_CXXFLAGS_ALLOW`),
a **regular expression** of additional flags to permit. It must be set for
every invocation that compiles the package -- `go build`, `go vet`, `go test`,
and any wrapper such as `wails build` -- which is why setting it in one place
and forgetting the others is the usual second round of this bug.

## WRONG

```go
// internal/capture/pipewire.go
/*
#cgo pkg-config: libpipewire-0.3 libspa-0.2
#include <pipewire/pipewire.h>
*/
import "C"
```

```bash
$ go build ./...
# example.com/internal/capture
invalid flag in pkg-config --cflags: -fno-strict-overflow

# The flag is not in your source:
$ grep -r 'strict-overflow' .          # nothing
# It comes from the library:
$ pkg-config --cflags libpipewire-0.3
-I/usr/include/pipewire-0.3 -I/usr/include/spa-0.2 -D_REENTRANT \
  -fno-strict-aliasing -fno-strict-overflow
```

Also wrong -- setting it for the build but not the test, so CI goes green
locally and red on the test job:

```yaml
- run: CGO_CFLAGS_ALLOW='-fno-strict-overflow' go build ./...
- run: go test ./...          # same error, different step
```

## RIGHT

```go
// Document the requirement next to the flag it is about, INSIDE the cgo
// preamble.
//
// A // comment placed immediately above the /* */ block is absorbed into the
// C preamble by cgo -- the comment becomes C source and the build fails with
// a syntax error in your own documentation. Put the note inside the block.
/*
// libpipewire's pkg-config emits -fno-strict-overflow, which is not on cgo's
// compiler-flag allowlist (see Go's cmd/go/internal/work/security.go). Every
// build of this package must set:
//
//     CGO_CFLAGS_ALLOW='-fno-strict-overflow'
//
// Without it the build fails with "invalid flag in pkg-config --cflags",
// which is an opaque error for a mundane constraint.
#cgo pkg-config: libpipewire-0.3 libspa-0.2
#include <pipewire/pipewire.h>
*/
import "C"
```

```makefile
# Export it once, at the top of the Makefile, so every go/wails invocation
# below inherits it. ?= so a caller can widen it.
export CGO_CFLAGS_ALLOW ?= -fno-strict-overflow
```

```yaml
# CI: set it on EVERY step that compiles the package, not just the build.
- name: Build
  env: { CGO_ENABLED: '1', CGO_CFLAGS_ALLOW: '-fno-strict-overflow' }
  run: go build ./...
- name: Vet
  env: { CGO_ENABLED: '1', CGO_CFLAGS_ALLOW: '-fno-strict-overflow' }
  run: go vet ./...
- name: Test
  env: { CGO_ENABLED: '1', CGO_CFLAGS_ALLOW: '-fno-strict-overflow' }
  run: go test ./...
```

## NOTES

- The `*_ALLOW` variables are **regular expressions**, not literal lists.
  Multiple flags are alternated: `CGO_LDFLAGS_ALLOW='-weak_framework|ScreenCaptureKit'`.
  A `.` in a flag name is a regex wildcard -- harmless in practice, but it means
  the match is looser than it looks.
- Set the **narrowest** pattern that works. `CGO_CFLAGS_ALLOW='.*'` makes the
  build pass and disables the protection the allowlist exists for, on a
  toolchain that reads `.pc` files from `PKG_CONFIG_PATH`.
- There are four variables, one per flag class: `CGO_CFLAGS_ALLOW`,
  `CGO_CXXFLAGS_ALLOW`, `CGO_FFLAGS_ALLOW`, `CGO_LDFLAGS_ALLOW`. Each also has
  a matching `_DISALLOW`. Getting the class wrong produces the identical error,
  because the flag is still rejected by the list you did not widen.
- Known flags that trip this: libpipewire's `-fno-strict-overflow`; macOS
  weak linking via `-weak_framework` (there is no `-Wl,` form that avoids it);
  hardening flags such as `-fno-delete-null-pointer-checks` and `-fwrapv` from
  distro-patched `.pc` files.
- Wrappers count. `wails build` shells out to `go build`, so the variable has
  to be exported into its environment too -- setting it only on the direct
  `go build` line leaves the GUI targets failing.
- Related trap in the same preamble: a `//` comment block immediately preceding
  `/* ... */ import "C"` is treated as C code. The symptom is a wall of C
  syntax errors quoting your own English prose.
