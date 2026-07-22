---
tech: supportforge
tags: [mcp, tickets, get_ticket_messages, pagination, truncation, context-window, silent-wrong-output]
severity: high
---
# get_ticket_messages limit truncates from the oldest end, hiding the newest replies

## PROBLEM
`get_ticket_messages` returns messages **oldest first** and applies `limit` as a head cut. `limit: 8` on an 11-message thread returns messages 1 through 8 and drops the three most recent.

This turns into silent wrong output because of a second property: every message carries a full `html` field, and each emailed reply quotes the entire thread before it, so payload size grows quadratically. A 16-message thread can exceed the tool-result size cap. The obvious reaction to an oversized result is to lower `limit` and retry — which returns cleanly, looks complete, and removes exactly the messages that matter.

Almost every question worth asking a ticket thread depends on the tail: who replied last, is the customer waiting on us or are we waiting on them, what was the most recent commitment. A head-truncated thread inverts all of it. Nothing in the response signals truncation; `count` reports what was returned, not what exists.

Observed live: ticket #206 at `limit: 8` ended on an outbound staff reply, reading as "waiting on customer." The full thread ended with three further inbound messages, the last of which asked the technician to phone the customer — two days earlier, unanswered.

## WRONG
```js
// Oversized result -> lower the limit -> looks fine, reads backwards.
let msgs = await get_ticket_messages({ ticket: 206, limit: 20 });
// Error: result exceeds maximum allowed tokens

msgs = await get_ticket_messages({ ticket: 206, limit: 8 });
const last = msgs.messages.at(-1);
// direction: "outbound" -> "ball is with the customer"   WRONG
// The 3 newest messages, all inbound, were dropped silently.
```

## RIGHT
```js
// Keep the limit high. When the payload overflows, the harness saves it to a
// file -- grep the two fields you need instead of shrinking the window.
const msgs = await get_ticket_messages({ ticket: 206, limit: 50 });
```

```bash
# On overflow: pull the tail cheaply. Ignore `html` -- it is a styled email
# template with no information the text fields lack.
grep -oE '"(direction|created_at)": "[^"]*"' "$FILE" | paste - - | tail -8
grep -oE '"stripped_text": "([^"\\]|\\.){0,220}' "$FILE" | tail -4
```

```js
// Cross-check that you actually have the tail:
const newest = msgs.messages.at(-1).created_at;
if (newest < ticket.updated_at) {
  // may be a field change rather than a message, but verify before concluding
}
```

## NOTES
- Read `stripped_text`, falling back to `text_body`. `html` is a full email template; on a long thread it is the entire size problem.
- `stripped_text` can be an empty string when a client sends HTML-only mail — fall back to `text_body`, and if both are empty check `html` for that one message rather than treating it as a blank reply.
- `count` reflects returned messages, not total messages. There is no `hasMore` on this tool, unlike `list_tickets`.
- Setting `include_internal_notes: false` is a legitimate way to shrink the payload when you only need customer-facing ball position — but notes are often where the real diagnostic state lives, so drop them deliberately.
- Related: [[list-tickets-includes-solved]] — the sibling gotcha on the same API, also a default that quietly returns something other than what the caller assumed.
