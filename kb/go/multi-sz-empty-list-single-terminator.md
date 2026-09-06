---
tech: go
tags: [windows, registry, multi-sz, parsing, empty-array, interoperability]
severity: high
---
# A double-NUL-only REG_MULTI_SZ reader drops empty lists written by x/sys

## PROBLEM

Win32 registry guidance describes REG_MULTI_SZ as ending with two NUL characters,
but golang.org/x/sys/windows/registry.SetStringsValue builds the encoding by
appending a NUL after each item and then a final NUL. With zero items it writes
one UTF-16 NUL. A reader that insists on two terminators rejects a value the
existing Go library just wrote successfully. An inventory/browser which omits
unreadable values then hides the empty value or reports a misleading partial
collection. Tests which only round-trip through a new custom writer miss it.

Confirmed against x/sys v0.47.0 on Windows with a temporary HKCU key. The important
distinction is the empty list; a nonempty list still needs its final empty-string
terminator.

## WRONG

```go
if !strings.HasSuffix(decoded, "\x00\x00") {
    return nil, errors.New("unterminated multi-string")
}
```

## RIGHT

```go
if decoded == "\x00" {
    return []string{}, nil // empty-string list terminator, no preceding item
}
if !strings.HasSuffix(decoded, "\x00\x00") {
    return nil, errors.New("unterminated multi-string")
}
body := strings.TrimSuffix(decoded, "\x00\x00")
if body == "" {
    return []string{}, nil
}
return strings.Split(body, "\x00"), nil
```

## NOTES

Test the actual established writer: call key.SetStringsValue("Empty", []string{}),
then read with the new implementation and assert that the value remains present
with an empty array. Keep UTF-16 validation, size bounds, and rejection of embedded
empty elements in nonempty lists. Do not use TrimRight to discard arbitrary NULs;
that can conceal malformed content. A writer may emit two terminators for the
empty case to accommodate strict consumers, while the reader accepts both.

Reference: https://learn.microsoft.com/en-us/windows/win32/sysinfo/registry-value-types
