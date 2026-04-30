---
tech: nextjs
tags: [stripe, webhooks, signature-verification, app-router, raw-body]
severity: high
---
# Stripe webhook signature verification needs the raw body, not a parsed JSON object

## PROBLEM
Stripe signs the raw request body. `stripe.webhooks.constructEvent(body, sig, secret)` recomputes the HMAC over the bytes you pass it — if you call `await req.json()` first, the JSON is reserialized when you stringify it back, the byte order and whitespace differ, and the signature check fails with a generic "No signatures found matching the expected signature" error. App Router gives no warning that this is the cause; you'll waste hours assuming the secret is wrong.

The default Stripe SDK error message also doesn't say "you parsed the body" — it says the signature is invalid, which most engineers debug by re-checking the secret in env vars instead.

## WRONG
```ts
// app/api/webhooks/stripe/platform/route.ts
export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature")!;
  const body = await req.json(); // destroys the raw bytes
  const event = stripe.webhooks.constructEvent(
    JSON.stringify(body),         // reserialized, byte order may differ
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );
}
```

## RIGHT
```ts
// app/api/webhooks/stripe/platform/route.ts
export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }
  const body = await req.text(); // raw bytes preserved
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
}
```

## NOTES
- Same rule applies to GitHub, Slack, Twilio, and any other webhook with HMAC body signing.
- App Router does not need the Pages-Router `bodyParser: false` config — `request.text()` always returns the unparsed body.
- If you need both the raw body and the parsed object, do `const raw = await req.text(); const json = JSON.parse(raw);` and pass `raw` to `constructEvent`. Never the other way around.
- Pair with `webhook_events` idempotency: claim the event once via `INSERT ... ON CONFLICT DO NOTHING` on `(stripe_event_id, endpoint_source)` so duplicate retries don't reprocess.
