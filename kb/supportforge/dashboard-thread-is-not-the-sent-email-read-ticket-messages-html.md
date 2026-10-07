---
tech: supportforge
tags: [email, ticket-messages, body_html, dashboard, mcp, add_ticket_reply, diagnosis]
severity: high
---
# The dashboard thread is not what the customer received; read ticket_messages.html

## PROBLEM
An outbound `ticket_messages` row holds three different renderings, and only one is the sent email:

- `html`: the full branded email exactly as delivered.
- `body_html`: the thread fragment only. It is NULL for a reply posted with no composer HTML (the MCP `add_ticket_reply` tool before 3.297.4.0, staff replies relayed from email).
- `text_body`: the plain text.

The dashboard renders an outbound row whose `body_html` is NULL through `MarkdownBody`. That uses react-markdown with remark-gfm and no remark-breaks, on `MESSAGE_PROSE` paragraphs pinned to `my-0`, so blank lines lose their gap and single newlines fold into spaces. The thread can therefore look crushed while the customer's email is fine.

On 2026-10-07 a session told the technician that a customer email was badly formatted. It based this on the dashboard view and a guessed converter, and proposed workarounds for a problem that did not exist. The stored `html` had correct `<br><br>` paragraph gaps; only the thread rendering was broken.

## WRONG
```text
"The email looks crushed in the ticket thread, so the converter must have dropped the blank lines."
(diagnosis from the dashboard view, get_ticket_messages, or body_html/text_body)
```

## RIGHT
```bash
psql "$(doppler secrets get DATABASE_URL_PUBLIC --plain -p supportforge -c prd)" -At \
  -c "SELECT html FROM ticket_messages WHERE id = '<message uuid>'"
# html is the delivered email. Judge delivery from this; treat the thread as evidence about rendering only.
```

## NOTES
- Fixed in SupportForge 3.297.4.0: plain-text replies now store composer-shaped `body_html` via `plainTextReplyHtml` (`src/services/email/reply-body-html.ts`), so the thread and the email agree.
- 3.298.0.0 added `format: text | markdown | html` to `add_ticket_reply`.
- The general rule: when a UI and a stored artifact disagree, find which column the UI actually renders before blaming the producer.
