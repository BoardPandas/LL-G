---
tech: supportforge
tags: [sanitize-html, dompurify, email, inbound-html, dead-code, test-fixtures, jest, quoted-reply]
severity: high
---
# A detection rule keyed on an attribute the sanitizer strips is dead code, and a hand-written fixture proves it works

## PROBLEM
Inbound email HTML passes through `sanitizeInboundHtml` (src/services/email/sanitize.ts)
before it is stored. That allowlist permits `style` on every tag plus a short per-tag
list of href/src/legacy table attributes -- `class` and `id` are on neither list, so
neither exists on a single stored body.

The dashboard's quoted-reply detector (`findQuoteBoundaryIndex` in
dashboard/src/components/tickets/RichHtmlBody.tsx) led with a rule matching Gmail's
`.gmail_quote` / `.gmail_extra` wrappers by class. It could not fire on any real
message. Its own doc comment asserted the opposite ("class ... survive[s]"), which is
what kept it alive through review.

Nothing reports this. The rule is valid code, the file typechecks, and the unit test
passed -- because the fixture was hand-written HTML that still carried the class, i.e.
markup the system never stores. The test proved the rule matches its own fixture, not
that the fixture matches production.

The visible symptom is the absence of a feature: Gmail replies never collapsed, and
the entire quoted thread rendered inline in the ticket timeline. It reads as "quote
detection is imperfect" rather than "one rule is unreachable".

Worse, the fallback did not cover it either. Gmail nests the attribution line AND the
quoted body in one wrapper, so that block's `textContent` is `"On ... wrote:"` followed
by the whole thread -- and the `/^\s*On\b...\bwrote:\s*$/` marker is `$`-anchored, so it
cannot match. Removing the dead rule without checking what the survivors actually do on
sanitized input would have shipped the same broken behaviour with tidier code.

The reflex fix -- allow `class` through the sanitizer -- is the wrong direction here.
These bodies are injected into a Tailwind page with `dangerouslySetInnerHTML`, and the
client-side pass (`sanitizeRichEmailHtml`) already permits `class`, so an inbound
`class="hidden"` or `class="fixed inset-0"` would hit compiled utility CSS and let a
sender hide their own text or paint over the UI. A class buys inbound mail nothing:
nothing renders it with the sender's stylesheet.

## WRONG
```tsx
// dashboard/src/components/tickets/RichHtmlBody.tsx
// "relies only on markers that survive sanitize (id is stripped; class ... survive)"
// -- false. sanitizeInboundHtml allows `style` + a per-tag list, and no `class`.
for (const [i, c] of children.entries()) {
  if (isElement(c) && (c.classList.contains('gmail_quote') ||
                       c.querySelector('.gmail_quote, .gmail_extra'))) {
    idx.push(i); break
  }
}

// ...and the test that "proved" it, written by hand with markup we never store:
it('splits at a Gmail quote container', () => {
  const { quoted } = splitQuotedHtml('<div>hi</div><div class="gmail_quote">older</div>')
  expect(quoted).toContain('older')   // passes, and means nothing
})
```

## RIGHT
```tsx
// Key the rule on what actually survives: tags and text.
// Gmail wraps the attribution line and the quoted body together, so strip the
// blockquotes before testing the `...wrote:$` marker.
function textWithoutQuotedBlocks(node: Node): string {
  if (!isElement(node) || !node.querySelector('blockquote')) return (node.textContent || '').trim()
  const copy = node.cloneNode(true) as Element
  copy.querySelectorAll('blockquote').forEach((b) => b.remove())
  return (copy.textContent || '').trim()
}
if (marker.test(textWithoutQuotedBlocks(c))) { idx.push(i); break }
```

```tsx
// Feed the fixture through the real sanitizer -- import it, never re-implement it.
import { sanitizeInboundHtml } from '../../../../../src/services/email/sanitize'

it('has no class attribute left to key a boundary rule on', () => {
  expect(sanitizeInboundHtml(GMAIL_WEB)).not.toContain('class=')
})

it('collapses a Gmail reply at the attribution line inside the quote wrapper', () => {
  const { head, quoted } = splitQuotedHtml(sanitizeInboundHtml(GMAIL_WEB))
  expect(head).toContain('Sounds good, thanks!')
  expect(quoted).toContain('We reset the password')
})
```

## NOTES
- The general rule: whenever code A detects something in data that code B produced,
  the test for A must run B. A fixture typed by hand encodes what you believe B emits,
  and that belief is exactly what is wrong. This applies to any
  sanitizer/normaliser/serialiser pair -- HTML sanitizers, markdown renderers, canonical
  JSON, PSA field mappers.
- Grep the sanitizer's allowlist before writing any selector against stored content.
  In this repo the two lists differ on purpose: `sanitizeOutboundHtml` DOES allow
  `class` (composer output), `sanitizeInboundHtml` does not. A rule that works on
  agent-authored bodies can be dead on inbound ones.
- Mutation-test the fix, since these tests are the kind that pass regardless: reverting
  the helper must fail the collapse tests, and adding `class` to the sanitizer's
  allowlist must fail the no-class assertion. Both were verified before landing.
- A doc comment asserting a fact about another module is not evidence. This one was
  confidently wrong and survived review for that reason -- verify the claim against the
  other file rather than reading the comment.
- Fixed in SupportForge v3.142.18.0.
