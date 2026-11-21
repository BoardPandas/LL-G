---
tech: semgrep
tags: [semgrep, opengrep, nosemgrep, suppression, sast, jsx, react, dangerouslysetinnerhtml, false-positive]
severity: high
---
# A nosemgrep comment above a JSX conditional wrapper suppresses nothing

## PROBLEM
Semgrep and Opengrep honour an inline `nosemgrep` comment only on the finding's first line or the line directly before it. In JSX the flagged element often sits inside a conditional (`{cond && (`, `{x ? (`, `) : y ? (`). A suppression written above that wrapper reads naturally, passes code review, and is one or two lines too high, so the scanner ignores it.

Nothing reports the miss. The scanner does not warn about a comment that matched no finding. The code looks suppressed, so the finding still showing in the scan dashboard gets triaged again or bulk-suppressed by hand. The next code move or rename brings the finding back.

A multi-line element has a second trap: depending on the rule, the finding can start on the element's opening line (`<div`) or on the prop line (`dangerouslySetInnerHTML=...`) a few lines below it. A comment that covers one of those lines can miss the other.

## WRONG
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

## RIGHT
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

A `//` comment is valid JavaScript inside the `(` before the JSX and between JSX attributes. Covering both the element line and the prop line works whichever line the rule reports.

## NOTES
- Check placement mechanically: for each `dangerouslySetInnerHTML=` (or other suppressed sink), walk back to the line that opens the tag and require `nosemgrep` on that line or the one above it, and on the prop line or the one above it.
- The same rule applies to `# nosec` (Gosec) and `# gitleaks:allow`: the comment belongs on the flagged line itself, not above a wrapper or a block.
- Seen in a 2026-11 code-security triage: several suppressions placed above conditional wrappers were inert. Which of them the scanner was still reporting was inferred from the code, because the platform's finding list was too large to read through the API.
