---
tech: bash
tags: [wc, macos, bsd, portability, string-comparison, tests]
severity: high
---
# macOS wc -l pads its count, so a string comparison never matches

## PROBLEM
BSD `wc` on macOS right-aligns its counts in 8-column fields, even when it reads
stdin. `printf 'a\n' | wc -l` prints `       1`, not `1`. A string test such as
`[ "$n" = "1" ]` is then false on every Mac and true on Linux with GNU `wc`.
CI passes and a Mac run fails, and the assertion looks correct when you read it.
In a test the failure message usually shows the padding (`exit 1,        1
PATCH(es)`), but it is easy to read past.

## WRONG
```bash
n=$(grep -l PATCH log/*.args | wc -l)
[ "$n" = "1" ] && echo ok      # false on macOS: n is "       1"
```

## RIGHT
```bash
n=$(grep -l PATCH log/*.args | wc -l | tr -d '[:space:]')
[ "$n" = "1" ] && echo ok

# or compare as a number; test(1) tolerates the leading blanks
[ "$n" -eq 1 ] && echo ok
```

## NOTES
- The same padding breaks `case "$n" in 0)`, `[[ $n == 0 ]]`, using the count in
  a filename or a JSON string, and an exact-match `grep -x`.
- `$(( n ))` arithmetic is safe, since the shell strips the whitespace.
- To reproduce on Linux, put a shim named `wc` first on PATH that reformats GNU
  output with `printf "%8d"`.
