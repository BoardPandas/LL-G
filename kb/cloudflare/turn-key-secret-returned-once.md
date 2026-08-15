---
tech: cloudflare
tags: [realtime, turn, api, secret, credentials, provisioning, webrtc]
severity: medium
---
# A Realtime TURN key's secret is returned once, at creation, and never again

## PROBLEM

`POST /accounts/{id}/calls/turn_keys` returns the new key's shared secret in the
creation response. Every later read — `GET .../turn_keys/{key_id}` — returns
`uid`, `name`, `created` and `modified` and **no secret**. There is no "reveal"
endpoint.

So a create call whose response you did not fully capture leaves you holding a
key you cannot authenticate with, and nothing about the key looks wrong: it
lists, it has a name, it can be fetched. The only remedy is to delete it and
create another.

This is easy to walk into when scripting, because the natural instinct is to
return a summary rather than the raw response — and the field is named `secret`,
not `key` or `token`, so a guard written from memory quietly reports "no token
present" while discarding the one thing that mattered.

Note also that the endpoint lives under `/calls/` rather than `/realtime/`,
which is where searching the OpenAPI spec for "realtime" will not find it.

## WRONG

```js
// Creates the key, then throws away the only copy of its secret.
const r = await cloudflare.request({
  method: "POST",
  path: `/accounts/${accountId}/calls/turn_keys`,
  body: { name: "my-turn-key" },
});
return { uid: r.result?.uid, hasToken: Boolean(r.result?.key) };
//                                                      ^^^ field is `secret`
// -> { uid: "f25d…", hasToken: false }   key exists, secret is gone forever
```

## RIGHT

```js
// Capture `secret` from the creation response and write it straight to the
// secret store in the same flow. There is no second chance to read it.
const r = await cloudflare.request({
  method: "POST",
  path: `/accounts/${accountId}/calls/turn_keys`,
  body: { name: "my-turn-key" },
});
return { uid: r.result?.uid, secret: r.result?.secret };

// Credentials are then minted per session against a DIFFERENT host --
// rtc.live.cloudflare.com, not api.cloudflare.com:
//   POST https://rtc.live.cloudflare.com/v1/turn/keys/$KEY_ID/credentials/generate-ice-servers
//   Authorization: Bearer $SECRET      body: {"ttl": 3600}
```

## NOTES

Verify the key end to end by actually calling `generate-ice-servers` before
building on it. A successful response returns a STUN entry with no credentials
and a TURN entry with a 64-character username and credential, over
`udp/3478`, `tcp/3478`, `tls/5349`, `udp/53`, `tcp/80` and `tls/443` — that last
one is worth knowing, since TURN over TLS on 443 traverses nearly any corporate
firewall.

Credential TTL is capped at 48 hours. Tie it to whatever session the credential
is for and clamp it, so a credential scraped out of a client handoff cannot
outlive the access it was issued for.

Billing is `$0.05/GB` of Cloudflare→client egress with 1,000 GB/month free
(shared with the SFU); ingress is free and relayed traffic is metered once, not
on both legs. Cloudflare routes TURN by anycast and documents **no region
pinning**, which makes it a data-residency decision as much as a technical one
if the relayed media is subject to residency commitments.
