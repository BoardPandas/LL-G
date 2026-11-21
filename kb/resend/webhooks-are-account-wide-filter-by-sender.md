---
tech: resend
tags: [resend, webhooks, bounce, complaint, suppression, svix, multi-product, shared-account]
severity: high
---
# Resend webhooks fire for every email on the account: allow-list events on your own sender

## PROBLEM
A Resend webhook is account-wide: it reports `email.bounced`, `email.complained`, etc. for every
email sent on the account, from every domain and product that shares it. A bounce/complaint
handler that suppresses whatever address an event names will therefore also act on other
products' mail -- a recipient who marks another product's email as spam stops receiving yours
(approval or sign-in mail included), and the other product's recipients land in your database.
Nothing errors; every event is validly signed.

## WRONG
```ts
const event = verifyAndParse(rawBody);              // svix-signed, so "trusted"
await suppress(event.data.to, event.type);          // anyone's mail on the account
```

## RIGHT
```ts
const addressOf = (v: string) => (/<([^<>]+)>\s*$/.exec(v)?.[1] ?? v).trim().toLowerCase();

const from = event.data?.from;                      // "Product <noreply@example.com>"
if (from === undefined || addressOf(from) !== addressOf(process.env.RESEND_FROM_EMAIL!)) {
  return c.json({ status: 'ignored', reason: 'sender' }); // 200 so Resend does not retry
}
await suppress(event.data.to, event.type);
```

## NOTES
- Allow-list, not deny-list: an event with no readable `from` is ignored, because it cannot be
  shown to be yours. Refuse to boot if the webhook secret is set without the sender address.
- Match the exact address, not the domain, when several products send from one domain.
- Production sending keys are usually restricted: `GET /webhooks` with one returns 401
  `restricted_api_key`. Create and rotate webhooks with a full-access key or the dashboard.
- The create-webhook response returns the `whsec_` signing secret; pipe it straight into the
  secret store rather than echoing it.
