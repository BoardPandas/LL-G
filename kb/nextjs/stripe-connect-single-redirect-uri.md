---
tech: nextjs
tags: [stripe, connect, oauth, multi-tenant, redirect-uri, state-parameter]
severity: high
---
# Stripe Connect Platform OAuth requires a single registered redirect URI — encode tenant ID in `state`

## PROBLEM
Stripe Connect Platform OAuth registers ONE redirect URI per platform in the dashboard. The OAuth `redirect_uri` parameter you send must match the registered value exactly — wildcards and per-tenant path segments (e.g., `/api/partner/[partnerId]/...`) cannot be registered. If you build a multi-tenant onboarding flow with the tenant ID in the path, OAuth completes but Stripe redirects to the registered URI with no tenant context, and your callback handler has no way to know which tenant just authorized.

The trap: it is natural in App Router to put the tenant ID in the URL because that is how every other route is structured. The OAuth redirect breaks the convention silently — your "start" route fires correctly, Stripe's onboarding succeeds, the redirect lands somewhere reasonable-looking, and only then do you discover the callback has no `partnerId` to write the `stripeConnectAccountId` against.

## WRONG
```ts
// /api/partner/[partnerId]/billing/connect/start/route.ts
const url = buildAuthorizeUrl({
  state: randomBytes(24).toString("hex"),
  redirect_uri: `https://app.example.com/api/partner/${partnerId}/billing/connect/callback`,
  // Stripe rejects: per-tenant URI is not pre-registered
});

// /api/partner/[partnerId]/billing/connect/callback/route.ts
// Stripe redirects to the registered URI which has no [partnerId] segment.
// This handler never runs.
export async function GET(req, { params }) {
  const { partnerId } = await params;
}
```

## RIGHT
```ts
// /api/partner/[partnerId]/billing/connect/start/route.ts
const random = randomBytes(24).toString("hex");
const state = `${partnerId}.${random}`;       // tenant ID + CSRF nonce
const url = buildAuthorizeUrl({
  state,
  redirect_uri: process.env.STRIPE_CONNECT_REDIRECT_URI, // single fixed value
});

// /api/billing/connect/callback/route.ts  (single fixed path)
export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state");
  if (!state || !state.includes(".")) {
    return NextResponse.redirect("/?connect_error=invalid_state");
  }
  const partnerId = state.split(".")[0];

  // Re-verify session role on the encoded tenant — `state` is
  // attacker-controllable, never trust the encoded ID without it.
  const role = await getActivePartnerRole(session.user.id, partnerId);
  if (!role) {
    return NextResponse.redirect(`/admin/partner/${partnerId}/settings?connect_error=forbidden`);
  }

  const exchanged = await exchangeAuthorizationCode(code);
  await db.update(partners).set({ stripeConnectAccountId: exchanged.stripeUserId })
    .where(eq(partners.id, partnerId));
}
```

## NOTES
- The `state` parameter is **NOT confidential** — the user sees it in the URL during the redirect flow. It's only protected against tampering by your role check on the callback. Always re-verify session role ownership of the encoded tenant ID before persisting anything.
- The same constraint applies to GitHub Apps, Slack OAuth, and most "platform OAuth" flows. Atlassian Connect and Salesforce app OAuth have similar single-redirect-URI rules.
- Don't rotate the redirect URI in your env without updating the Stripe dashboard at the same time — mismatched URIs produce a confusing `redirect_uri_mismatch` error from Stripe.
- The Connect Platform `client_id` (`ca_…`) is readable from any connect-mode webhook endpoint's `application` field, but the redirect URI list is dashboard-only — there is no API to list or set it.
