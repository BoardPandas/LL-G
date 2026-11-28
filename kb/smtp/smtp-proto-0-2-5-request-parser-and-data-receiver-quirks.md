---
tech: smtp
tags: [smtp-proto, rust, parser, line-length, size, postmaster, quoted-local-part, data, dot-stuffing, submission]
severity: high
---
# smtp-proto 0.2.5: the request parser and DATA receiver accept or rewrite input in ways a server must not rely on

## PROBLEM
Observed in the Rust `smtp-proto` crate, version 0.2.5. None of these raise an error; each returns a plausible parsed value.

Request parser:
- It has **no line-length bound**. A command line can grow without limit unless the caller frames lines first.
- It **deletes CR bytes anywhere** in a command line, so a line containing a stray CR parses as if the CR were not there.
- It maps `<postmaster>` and `<>` to the **same empty address**, so the null reverse-path and the special postmaster recipient cannot be told apart afterwards.
- It **drops the quotes** from quoted local parts, so `"a b"@example.com` comes back as a different address from the one sent.
- An over-long `SIZE=` value **wraps to a small number** instead of being refused, so a huge declared size passes a size check.

DATA receiver:
- It ends a message on `.\r\r\n`, which is not the end-of-data sequence.
- It does not terminate on a **first line** of `.` (an empty message ended immediately).

## WRONG
```text
- Feed bytes from the socket straight to the request parser, with no line framing of your own.
- Refuse a message when the parsed SIZE exceeds the limit, and otherwise trust it
  (a wrapped SIZE is small and passes).
- Compare parsed addresses for policy without looking at the raw line.
- Let the crate's DATA receiver decide where the message ends.
```

## RIGHT
```text
- Frame lines yourself: read up to a fixed maximum, require the line to end in CRLF,
  and refuse a line with a CR or LF anywhere else, before handing it to the parser.
- Check the raw line for the cases the parser merges: <> versus <postmaster>, and
  quoted local parts (refuse them or handle them from the raw bytes).
- Treat SIZE as advisory: enforce the real limit by counting the bytes of DATA as they arrive.
- Read DATA yourself: end of data is exactly CRLF "." CRLF, including when "." CRLF is the first line.
```

## NOTES
- These are observations of one version; re-test them when upgrading before removing a guard.
- Each item makes a good fuzz or table test: the raw line, what the crate returned, what the server must do.
- Related: `bare-cr-or-lf-in-message-data-smtp-smuggling.md` on this shelf.
