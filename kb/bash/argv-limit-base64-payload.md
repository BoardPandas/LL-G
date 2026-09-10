---
tech: bash
tags: [argv, command-line-limit, base64, gh, github-cli, e2big, scaling]
severity: medium
---
# A base64 payload passed as an argv element outgrows the command-line limit, so the script breaks on a threshold nothing announces

## PROBLEM

Passing file contents to a CLI as an argument works, is easy to test, and keeps
working right up until the file gets big -- at which point the exec fails before
the program runs at all:

```
/c/Program Files/GitHub CLI/gh: Argument list too long
exit 126
```

Two things make this land much later than you would expect, and much harder to
attribute:

- **base64 inflates by 4/3.** A 56 KB file is a 75 KB argument. The limit is on
  the encoded size, not the size you are thinking about.
- **The ceiling is far lower than Linux muscle memory suggests.** Windows/msys
  caps a command line near 32 KB, so the effective file ceiling is roughly
  24 KB -- not the ~2 MB `ARG_MAX` a Linux developer assumes. The same script
  can pass CI on Linux and fail only on a contributor's Windows box.

The result is a **latent, data-dependent** failure. The script is written and
tested against small inputs and is genuinely correct for them; the defect
arrives later, when a file on the other side of the script grows past a
threshold nobody is tracking. In a knowledge-base helper, the per-entry files
(~6 KB) kept working long after the ever-growing master index (56 KB) had
stopped, so the tool looked healthy while its most important write was dead.

`exit 126` compounds the misattribution: it is the shell reporting "cannot
execute", so it names the interpreter, not your data. It reads like a broken
install or a PATH problem, not like a payload that got too big.

## WRONG

```sh
content_b64="$(base64 "$content_file" | tr -d '\r\n')"

# Fine at 6 KB. Dies at 24 KB. Nothing in between warns you.
gh api "repos/${repo}/contents/${path}" --method PUT
  -f "message=${message}"
  -f "content=${content_b64}"
```

## RIGHT

```sh
content_b64="$(base64 "$content_file" | tr -d '\r\n')"

# Assemble the request body and hand it over on STDIN. A shell variable and a
# pipe have no comparable limit; only argv does.
#
# Note gh's own constraint: --input takes the WHOLE body, and field flags are
# not merged into it (gh appends those to the query string), so every field has
# to be built here once you switch.
build_body() {
    printf '{"message":"%s","content":"%s"}' "$(json_escape "$message")" "$content_b64"
}

build_body | gh api "repos/${repo}/contents/${path}" --method PUT --input -
```

## NOTES

- **The rule of thumb: anything derived from a file's *contents* belongs on
  stdin or in a temp file, never in argv.** Argv is for names, flags and ids --
  values whose size is bounded by something other than user data.
- Same failure, same cause, elsewhere: `curl -d "$payload"`, `psql -c "$sql"`
  built from a file, `aws ... --cli-input-json "$blob"`, `jq --argjson data
  "$blob"`. All have a stdin or `@file` form; prefer it from the start.
- Some CLIs offer a middle road: `gh api -F key=@file` reads a field value from
  a file. It keeps the payload out of argv, but `-F` applies magic type
  conversion (`true`, `false`, `null`, integers become JSON types), and the
  string-typed `-f` does **not** support `@`. Know which one you are using.
- Test with a file several times the size you expect, not a representative one.
  A fixture that mirrors today's data proves nothing about the threshold; the
  bug is defined by growth.
- `getconf ARG_MAX` reports the platform limit, but the usable budget is
  smaller (the environment block shares it), so treat it as an upper bound
  rather than a target.
