---
tech: go
tags: [build-tags, goos, cross-platform, testing, ci, coverage]
severity: high
---
# A `_darwin`/`_windows` filename silently makes a test file unrunnable, and CI may run that GOOS nowhere

## PROBLEM

Go applies an implicit build constraint from the **filename**, and it strips
`_test` before matching. So `patches_darwin_test.go` becomes `patches_darwin`,
matches the recognised GOOS `darwin`, and is darwin-only — no build tag involved.

Two consequences that compound:

1. **You cannot override it.** An explicit `//go:build` line is ANDed with the
   filename constraint, never substituted for it. `//go:build linux` on a file
   named `x_darwin.go` yields a file that builds nowhere at all.

2. **Nothing reports the absence.** `go test ./...` on Linux says `ok` for the
   package. `GOOS=darwin go vet ./...` is clean. `gofmt` is clean. Coverage
   tooling shows no gap, because from Linux's point of view the file does not
   exist. A test file that has never run and cannot fail is indistinguishable
   from one that passes.

The trap closes when CI has no runner for that GOOS. A typical setup builds the
macOS artifact on `macos-latest` (compile, sign, notarize, upload) and runs the
Go test job somewhere cheaper — `ubuntu-latest` or `windows-latest`. Then every
`_darwin_test.go` in the repository executes on **no machine, ever**, while
looking like coverage in review and in the file tree.

Observed: 223 lines and ~14 tests of macOS parsing logic that had never executed
anywhere. Moving them to an un-suffixed file and running them immediately found
a real defect the suite could not have caught.

## WRONG

```go
// patches_darwin.go — pure parsing mixed in with the exec boundary
package inventory

func collectPatchAssessment() *Report { /* runs `softwareupdate` */ }

// Pure string parsing, no syscall, no reason to be darwin-only —
// but it is, because of the filename.
func parseSoftwareUpdateList(output string) []Listing { /* ... */ }
```

```go
// patches_darwin_test.go — strips to `patches_darwin`, so: darwin only.
// Never executes on a Linux dev box or a Linux/Windows CI runner.
func TestParseSoftwareUpdateList(t *testing.T) { /* ... */ }
```

```go
// Does NOT help. The tag is ANDed with the filename: darwin AND linux = never.
//go:build linux
```

## RIGHT

Keep the platform file thin — only what genuinely needs the syscall or exec —
and put the pure logic in a file with **no GOOS suffix**, where it compiles and
tests on every platform:

```go
// patches_darwin.go — the exec boundary only.
package inventory

func collectPatchAssessment() *Report {
    out := run("softwareupdate", "--list")
    return assessmentFrom(parseSoftwareUpdateList(out))   // logic lives elsewhere
}
```

```go
// patches_softwareupdate.go — NO suffix. Builds and tests everywhere.
package inventory

func parseSoftwareUpdateList(output string) []Listing { /* ... */ }
```

```go
// patches_softwareupdate_test.go — NO suffix. Actually runs.
func TestParseSoftwareUpdateList(t *testing.T) { /* ... */ }
```

Prove the tests execute rather than assuming it. A filtered run is the cheapest
check, and the answer before the fix is unambiguous:

```
$ go test ./internal/inventory/... -run 'SoftwareUpdate' -v
testing: warning: no tests to run        # before: the file is invisible
--- PASS: TestParseSoftwareUpdateList     # after
```

## NOTES

- Recognised suffixes are any GOOS or GOARCH: `_darwin`, `_windows`, `_linux`,
  `_amd64`, `_arm64`, and GOOS_GOARCH pairs like `_linux_amd64`. A file named
  after a domain concept that happens to collide — `cache_windows.go` for a
  Windows *feature*, `parser_arm64.go` for ARM *support* — picks up the
  constraint whether or not you meant it.
- Sanity check before trusting any per-platform suite:
  `go list -f '{{.GoFiles}} {{.TestGoFiles}}' ./...` under each GOOS, and diff
  what appears. Files that appear under no GOOS your CI runs are dead.
- Audit CI explicitly. "We build on macOS" is not "we test on macOS" — a
  build/sign/notarize job proves compilation, not behaviour.
- If logic genuinely cannot be separated from the syscall, say so and leave the
  test platform-gated deliberately, with a comment naming the runner that would
  execute it. The failure mode here is not platform-gating; it is platform-gating
  by accident and then counting it as coverage.
- The same split is worth making regardless of CI: pure logic in a portable file
  is testable on a developer's own machine, which is usually the difference
  between tests that get written and tests that do not.
