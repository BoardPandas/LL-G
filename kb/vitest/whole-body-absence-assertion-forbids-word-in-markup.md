---
tech: vitest
tags: [not-toContain, substring, class-names, html, restyle, information-leak]
severity: medium
---
# A whole-body absence assertion also forbids the word in class names and comments

## PROBLEM
A security test guarantees a denial page does not reveal *why* access was denied, by asserting the response body never contains reason words such as `revoked` or `deny_expired`. The assertion runs over the whole HTML string, so it also forbids those substrings in CSS class names, inline `<style>` blocks and HTML comments, none of which a reader sees. A restyle that reuses the panel's status classes (`class="pill revoked"`) fails it with a message that looks like an information leak. The tempting fix, loosening the assertion to visible text, can make it pass vacuously if the copy later changes. The constraint is invisible to anyone editing markup or CSS unless they have read the test.

## WRONG
```ts
// test: the 403 page must not say which reason applied
expect(body).not.toContain("revoked");

// later restyle, reusing a status vocabulary across pages
return `<span class="pill revoked">403 · NOT AUTHORIZED</span>`; // test fails
```

## RIGHT
```ts
// name classes on that page for their look, never for a reason
return `<span class="tag">403 · NOT AUTHORIZED</span>`;

// keep the assertion whole-body (markup can leak too) and pin the copy that must be identical
for (const word of ["revoked", "deny_grant", "deny_expired", "deny_draft"]) {
  expect(body).not.toContain(word);
}
expect(body).toContain("You don't have access to this document");
```

## NOTES
- Put the constraint in the restyle brief before markup work starts: "this page's HTML must not contain X, including class names".
- Prefer neutral status class names everywhere (`p-deny`, not `revoked`) so one vocabulary is safe on every page.
- Pair every absence assertion with a positive one on the expected copy so it cannot pass vacuously. See [A negative text assertion goes vacuous when the text it names changes](negative-text-assertion-vacuous-after-copy-change.md).
