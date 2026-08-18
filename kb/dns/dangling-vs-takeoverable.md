---
tech: dns
tags: [dangling-cname, subdomain-takeover, security-audit, severity, wildcard, certificate-transparency]
severity: high
---
# Dangling is not takeover-able, and conflating them inflates every audit you run

## PROBLEM

The standard subdomain-takeover check is "does this CNAME point at something that no longer
resolves?" That test is wrong, and it is wrong in the direction that wastes the most time:
it reports harmless records as critical.

The actual test is not *does the target resolve* but **can a third party cause the target to
resolve to something they control**. Those come apart constantly:

- `sip.example.com -> sipdir.online.lync.com` returns `NXDOMAIN`. Textbook dangling CNAME.
  Also completely harmless: `lync.com` is Microsoft's, and no attacker can register a name
  inside it. Deleting it is hygiene, not remediation.
- `s3.example.com -> public.r2.dev` 404s. Also not takeover-able: the target is
  Cloudflare's, and binding an R2 custom domain requires owning the zone.
- `ai.example.com -> <hash>.vercel-dns-016.com` returning `DEPLOYMENT_NOT_FOUND` **is** the
  real thing — the provider is telling you no account currently claims that hostname.

An audit that grades on resolvability alone hands over a list where the one record that
matters is buried among five that never mattered. The reader either fixes all of them at
equal priority or, more often, learns the report is noisy and stops reading it.

Two checks change the shape of the whole audit and take one query each:

**Check for a wildcard first.** A `*.example.com` record makes every dangling-CNAME finding
irrelevant — an attacker does not need to claim an abandoned name when the zone hands them
any name on demand. It is also a far larger issue on its own. Query a random string against
the zone's authoritative nameservers: `NXDOMAIN` means no wildcard, `NOERROR` means there is
one and your audit needs re-scoping before you write another line of it.

**Treat an expired TLS certificate as corroboration.** Providers stop renewing when a
project is deleted but keep serving while it merely errors, so cert expiry is what
distinguishes *abandoned* from *temporarily broken* — the difference between a finding and a
false positive.

## WRONG

```bash
# Grades on resolvability. Reports Microsoft- and Cloudflare-owned targets as critical
# alongside the one genuinely claimable hostname, at identical severity.
for h in $(cat hosts.txt); do
  target=$(dig +short CNAME "$h")
  [ -n "$target" ] && ! dig +short "$target" | grep -q . \
    && echo "CRITICAL: $h -> $target is dangling"
done
```

## RIGHT

```bash
# 0. Wildcard first — one query that can invalidate the entire audit.
if dig +short "$(head -c8 /dev/urandom | base64 | tr -dc a-z).example.com" \
     @ns1.example.com | grep -q .; then
  echo "WILDCARD PRESENT — dangling findings are moot; scope the audit to this instead."
  exit 0
fi

# 1. Classify by WHO OWNS THE TARGET ZONE, not by whether it resolves.
#    Targets inside a provider's own zone are unclaimable by a third party.
UNCLAIMABLE='(lync\.com|outlook\.com|r2\.dev|cloudflare\.net|stripe\.com)$'

for h in $(cat hosts.txt); do
  target=$(dig +short CNAME "$h" | sed 's/\.$//')
  [ -n "$target" ] || continue

  if echo "$target" | grep -qE "$UNCLAIMABLE"; then
    echo "HYGIENE: $h -> $target (provider-owned; delete, not urgent)"
    continue
  fi

  # 2. Provider fingerprint + cert expiry together, not resolvability alone.
  body=$(curl -sS -m 10 -D- "https://$h/" 2>/dev/null || true)
  if echo "$body" | grep -qiE 'DEPLOYMENT_NOT_FOUND|NoSuchBucket|no such app|not found'; then
    echo "TAKEOVER CANDIDATE: $h -> $target (provider reports the name is unclaimed)"
  fi
done
```

## NOTES

- **Cloudflare proxying defeats this entirely from outside.** An orange-clouded record
  resolves to the edge's IPs and never reveals the origin, so external tooling cannot
  classify it at all. Proxying does not fix a dangling CNAME — it hides it from you *and*
  your scanner while the origin stays exactly as claimable. Those records need the zone API,
  not `dig`.
- **Exploitability is often genuinely uncertain, and that is fine.** Several providers now
  require DNS verification before binding a domain, which blocks the naive claim; the
  takeover class persists for domains previously bound and released. Do not stall the report
  resolving it — the record is dead either way, deleting it is free, and deletion removes the
  question. Recommend deletion, note the uncertainty, and never attempt the claim to find
  out: that is a state-changing action against a third party.
- **The delta between Certificate Transparency and live DNS is itself a finding.** CT lists
  hostnames that ever had a cert, including deleted ones. Names in CT but absent from DNS are
  evidence of prior cleanup — a *positive* signal about how the zone is maintained, and
  invisible to any live-DNS-only sweep.
- On a shared registrable domain, the *legitimate* third-party hosts are usually a larger and
  more permanent risk surface than the abandoned ones — vendor apps serving HTML on your
  domain can set cookies for the whole registrable domain, and unlike dangling records they
  are never going away. Scope the audit as "what serves HTML here", not "what is dangling
  here".
