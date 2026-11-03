---
tech: go
tags: [crlf, windows, testing, os.ReadFile, strings.Index, autocrlf]
severity: high
---
# Go tests that scan source text for \n panic on a Windows CRLF checkout

## PROBLEM
A test that reads a source file and slices on `strings.Index(text, "\n...")` passes on Linux but panics on a Windows runner, because git there checks text out with CRLF.
`Index` returns -1, `text[:-1]` panics, and the panic aborts the whole package, hiding every later test. If CI's Go gates run only on Linux, the first Windows run (often a release build) is where it surfaces.

## WRONG
```go
text := string(source)
block := text[strings.Index(text, "if runtime.GOOS == \"windows\" {"):]
block = block[:strings.Index(block, "\n\t}\n")] // -1 on CRLF -> panic
```

## RIGHT
```go
text := strings.ReplaceAll(string(source), "\r\n", "\n")
start := strings.Index(text, "if runtime.GOOS == \"windows\" {")
if start < 0 {
	t.Fatal("marker missing")
}
block := text[start:]
end := strings.Index(block, "\n\t}\n")
if end < 0 {
	t.Fatal("closing brace missing")
}
block = block[:end]
```

## NOTES
Reproduce on Linux: `git -c core.autocrlf=true clone --shared <repo> crlf && cd crlf && go test ./pkg`. Alternatively pin `*.go text eol=lf` in `.gitattributes`. Related: git/crlf-expansion-doubles-file.
