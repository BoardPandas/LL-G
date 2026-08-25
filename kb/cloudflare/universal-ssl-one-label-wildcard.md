---
tech: cloudflare
tags: [ssl, tls, universal-ssl, wildcard, subdomain, acm, certificate, dns, proxy]
severity: high
---
# Universal SSL covers ONE label, so a two-label subdomain fails the handshake behind the proxy

## PROBLEM

Cloudflare's free Universal SSL certificate is issued for exactly two names: the apex
(`example.com`) and a single-level wildcard (`*.example.com`). **A DNS wildcard matches exactly
one label.** So `api.example.com` is covered and `api.internal.example.com` is not.

Proxy (orange-cloud) a two-label host and the edge has no certificate to present. It does not
serve a wrong certificate or a 5xx you can read — it aborts the TLS handshake with alert 40
(`handshake_failure`). The browser reports `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`, which reads
like a cipher-suite or TLS-version misconfiguration and sends you to inspect the origin's TLS
settings. The origin is fine and completely uninvolved: nothing ever reached it.

Three things make this hard to see:

- **The sibling host works.** `app.example.com` (one label) is covered by the wildcard and
  serves normally, so DNS, the proxy and the certificate all look healthy.
- **The origin verifies fine** if you test it directly with the right SNI, because Railway /
  Vercel / Fly issued a real certificate for the exact hostname. Only the edge is broken.
- **A browser-side symptom hides the cause.** If a static SPA on the working host calls an API
  on the broken one, the visible failure is the SPA hanging on a loading state — the API calls
  die in the network layer before any status code exists to render.

Covering a two-label host requires **Advanced Certificate Manager** ($10/mo per zone). Ordering
a certificate pack without it returns error **1450** ("Access to configure this resource has not
been granted for this zone"). Existing `advanced`-type packs in the zone do **not** prove ACM is
active — lapsed packs stay listed as `active`.

## WRONG

```bash
# Two labels deep, proxied. The edge has no certificate for this name.
# DNS resolves to Cloudflare, and TLS dies before the origin is consulted.
#   api.internal.example.com  CNAME -> origin.example.net   [orange-cloud]

$ curl https://api.internal.example.com/health
curl: (35) TLS connect error: error:0A000410:SSL routines::ssl/tls alert handshake failure

# The misleading part: chasing this at the origin, which is healthy and never saw the request.
# And the sibling host works perfectly, "proving" the setup is fine:
$ curl -o /dev/null -w '%{http_code}\n' https://app.example.com/
200
```

## RIGHT

```bash
# 1. CONFIRM it is the edge certificate, not the origin. Read the SANs actually served:
$ echo | openssl s_client -connect app.example.com:443 -servername app.example.com 2>/dev/null \
    | openssl x509 -noout -text | grep -A1 "Subject Alternative Name"
    X509v3 Subject Alternative Name:
        DNS:example.com, DNS:*.example.com      # <- one label only

# 2. PROVE the origin is healthy by bypassing Cloudflare with the real SNI + Host:
$ curl --connect-to api.internal.example.com:443:origin.example.net:443 \
       https://api.internal.example.com/health
{"status":"ok"}                                 # origin was never the problem

# 3a. FIX, keeping the proxy: buy ACM, then order a pack covering the deeper wildcard.
#     Without ACM this returns 1450.
POST /zones/{zone_id}/ssl/certificate_packs/order
{ "type": "advanced",
  "hosts": ["internal.example.com", "*.internal.example.com"],
  "validation_method": "txt", "validity_days": 90,
  "certificate_authority": "google" }

# 3b. FIX, free and immediate: grey-cloud (DNS-only) that one record. The browser then
#     terminates TLS directly against the origin, which already has a valid certificate.
#     Know what you give up -- see NOTES.
```

## NOTES

Grey-clouding is the free fix, but it removes the host from the Cloudflare data path entirely.
Costs worth stating before choosing it:

- No WAF, no DDoS filtering, no caching, and the origin IP becomes public.
- **Any application logic keyed to a Cloudflare-injected header silently changes behaviour.**
  The one that bites: rate limiters configured to read `CF-Connecting-IP` (the standard advice,
  because `X-Forwarded-For` is a spoofable multi-hop chain) now find no such header and collapse
  every caller into a single shared bucket. Better Auth logs this as "Rate limiting could not
  determine a client IP"; other frameworks fail silently. If that host serves auth endpoints,
  you have quietly disabled per-client rate limiting on your sign-in path. Switching to
  `X-Forwarded-For` is not a fix — its first entry is client-supplied.
- Any per-hostname Configuration Rule (SSL mode, cache, security level) becomes inert for that
  host. Leave the rules in place; they matter again the moment it is re-proxied.

**Do not "fix" this by flattening the hostname** (`api.internal.example.com` ->
`api-internal.example.com`) without checking cookie scope. If sessions are scoped to
`.internal.example.com`, the flattened sibling forces them out to `.example.com`, exposing them
to every other property on the zone — a security regression traded for a certificate.

Related: [Proxying a DNS-only record activates every Cloudflare-layer feature on that
host](dns-only-to-proxied-activates-features.md) is the mirror image — this entry is about
proxying breaking a host, that one about proxying activating rules on it. Check both before
flipping a cloud icon in either direction.
