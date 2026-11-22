---
tech: semgrep
tags: [semgrep, opengrep, nosemgrep, suppression, sast, jsx, react, dangerouslysetinnerhtml, false-positive, partial-parsing]
severity: high
---
# A paren-wrapped JSX match starts on the wrapper line, so nosemgrep goes above that line

## PROBLEM
Semgrep and Opengrep honour an inline `nosemgrep` comment only on the finding's start line or the line directly before it. When the flagged JSX element is wrapped in parentheses (`{cond && (`, `{x ? (`, `) : y ? (`, `return (`), the match starts on the **wrapper line**, the one holding the opening `(`. It does not start on the `<div` line or on the `dangerouslySetInnerHTML=` prop line.

A comment moved "closer" to the sink, inside the parens, is one or more lines too low and is silently ignored. Nothing reports it, because the scanner never warns about a comment that matched no finding. An earlier version of this entry recommended exactly that placement. Following it reopened three findings that had been correctly suppressed.

## WRONG
```tsx
{/* quoted is DOMPurify output, never raw html. */}
{showQuoted && (
  // nosemgrep: javascript.react.dangerouslysetinnerhtml
  <div
    className="quoted"
    // nosemgrep: javascript.react.dangerouslysetinnerhtml
    dangerouslySetInnerHTML={{ __html: quoted }}
  />
)}
```

## RIGHT
```tsx
{/* quoted is DOMPurify output, never raw html. */}
{/* nosemgrep: javascript.react.dangerouslysetinnerhtml */}
{showQuoted && (
  <div
    className="quoted"
    dangerouslySetInnerHTML={{ __html: quoted }}
  />
)}
```

```tsx
// nosemgrep: javascript.react.dangerouslysetinnerhtml
return (
  <div dangerouslySetInnerHTML={{ __html: safeHtml }} />
)
```

## NOTES
- Verify, don't eyeball. Run `opengrep scan --config <rule> --json --disable-nosem <file>` and read each result's `start.line` and `extra.is_ignored`. With a stand-in rule that has the hosted rule's id, the local start lines matched the hosted scanner's reported lines exactly.
- **A backtick in a comment can hide the match.** A `//` comment containing backticks near a regex literal that also contains one (for example `` /`|^ {0,3}~{3}/ ``) can make Opengrep fail to parse that region (`PartialParsing` in the `errors` array) and drop the match. The finding then looks fixed only because the code is no longer parsed. Check `errors` for `PartialParsing` overlapping the match, and keep backticks out of suppression comments.
- On a hosted dashboard, a moved line can show as a new finding ("alerting since 1 hour ago"), so a finding's age does not prove the old placement was failing.
- Gosec's `#nosec` follows a different rule. See `kb/go/gosec-nosec-on-if-init-line-ignored.md`.
