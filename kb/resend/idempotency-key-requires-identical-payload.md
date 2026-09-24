---
tech: resend
tags: [resend, idempotency-key, email, retries, at-least-once, unsubscribe, bulk-send]
severity: high
---
# A Resend idempotency key suppresses a duplicate only if the retry is byte-identical

## PROBLEM
Resend's `Idempotency-Key` (the SDK's `resend.emails.send(payload, { idempotencyKey })`) is the obvious guard against the classic send-then-record crash: the provider accepts the email, the process dies before the database commit, and the next attempt sends it again. It only works when the retry carries the **same key and the same payload**. Resend then returns the original response without sending. If the key matches but the payload differs, Resend answers `409 invalid_idempotent_request` ("this idempotency key has already been used on a request that had a different payload").

The trap is any per-recipient value minted *at send time*: an unsubscribe token, a tracking id, a signed link with a timestamp, a rendered date. Each attempt produces a different body under the same key. The retry after an uncommitted success is then refused with a 409 on a message that was **actually delivered**. A worker that treats that as a failure records "failed" for somebody who got the email, and eventually gives up on them, or it drops the idempotency key to get past the 409 and sends a duplicate.

Keys are kept for 24 hours, so a retry backoff longer than that silently loses the protection too.

## WRONG
```typescript
// Token minted per attempt: every retry is a different payload under the same key.
async function sendOne(row: SendRow) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query('UPDATE sends SET unsubscribe_token = $2 WHERE id = $1', [row.id, token]);
  await resend.emails.send(
    { to: row.email, subject, html: render(body, `${BASE}/unsubscribe/${token}`) },
    { idempotencyKey: `campaign-send/${row.id}` },
  );
  await markSent(row.id); // crash here -> next attempt gets 409 for a delivered email
}
```

## RIGHT
```typescript
// Token fixed when the recipient is queued; every attempt renders the same bytes.
// INSERT INTO sends (..., unsubscribe_token)
//   SELECT ..., replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') ...
async function sendOne(row: SendRow) {
  await resend.emails.send(
    { to: row.email, subject, html: render(body, `${BASE}/unsubscribe/${row.unsubscribe_token}`) },
    { idempotencyKey: `campaign-send/${row.id}` },
  );
  await markSent(row.id); // crash here -> retry returns the first result, sends nothing
}
```

## NOTES
- Anything that can change between attempts breaks it: the stored body must also be frozen while sending (refuse edits to a campaign in a `sending` state), and the render must not embed "now".
- Keep the retry backoff well inside the 24-hour key lifetime.
- Pair it with send-then-record in one transaction holding a `FOR UPDATE SKIP LOCKED` row lock, so concurrency never produces the duplicate. The key only has to cover a crash.
- Seen in SupportForge campaign sending (2026-09-24): `crm_campaign_sends.unsubscribe_token` is minted in the snapshot insert for this reason.
