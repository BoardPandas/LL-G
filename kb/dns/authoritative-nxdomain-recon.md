---
tech: dns
tags: [enumeration, authoritative-nameserver, nxdomain, zone-audit, certificate-transparency, resolver]
severity: medium
---
# Reconstruct a zone's contents without API access by asking its authoritative nameservers

## PROBLEM

Auditing a DNS zone you cannot read through an API — no credentials, connector unavailable,
third-party zone — usually falls back to guessing hostnames and seeing which resolve. That
misses every name carrying only `TXT`, `MX`, or `SRV` records, which is exactly where mail
authentication, domain verification, and service discovery live.

The fix is that **existence and content are separate questions**, and DNS answers the first
one directly. A nameserver returns `NOERROR` for a name that exists in the zone even when the
specific record type you asked for is absent, and `NXDOMAIN` only when the name does not
exist at all. So `NOERROR` on a type the name does not have still proves the name is there.

The catch: **you must ask the zone's own authoritative nameservers.** Public recursive
resolvers blur this distinction — in practice `1.1.1.1` returned `NOERROR` for a random
string that the authoritative nameserver correctly called `NXDOMAIN`. Run the sweep against a
recursor and every probe looks like a hit, which reads as success and is worthless.

Combined with Certificate Transparency for candidate names, this reconstructs a zone closely
enough to audit. On a real 64-record zone this recovered every name — verified afterwards
against the API once it became reachable.

## WRONG

```bash
# Two problems. Only finds names with A/CNAME records, so every TXT/MX-only name
# (_dmarc, _domainkey, verification tokens, SRV targets) is invisible. And asking a
# public recursor means you cannot trust a negative — or a positive.
for name in $(cat wordlist.txt); do
  dig +short "$name.example.com" @1.1.1.1 | grep -q . && echo "found: $name"
done
```

## RIGHT

```bash
NS=$(dig +short NS example.com | head -1)

# Sanity-check the method BEFORE trusting it: a random name must come back NXDOMAIN.
# If it does not, the zone has a wildcard and existence probing is meaningless here.
probe=$(head -c8 /dev/urandom | base64 | tr -dc a-z)
if [ "$(dig +noall +comment "$probe.example.com" @"$NS" | grep -o 'status: [A-Z]*')" \
     != "status: NXDOMAIN" ]; then
  echo "Wildcard present — existence probing cannot work on this zone."; exit 1
fi

# NOERROR means the NAME exists, whatever record types it carries.
# NXDOMAIN means it does not. Ask for ANY; the status is the signal, not the answer.
for name in $(cat candidates.txt); do
  status=$(dig +noall +comment "$name.example.com" @"$NS" | grep -o 'status: [A-Z]*')
  [ "$status" = "status: NOERROR" ] && echo "exists: $name.example.com"
done
```

Build `candidates.txt` from Certificate Transparency rather than a generic wordlist — it
yields names actually used by this organisation, including ones already deleted:

```bash
curl -sS "https://crt.sh/?q=%25.example.com&output=json" \
  | jq -r '.[].name_value' | tr '[:upper:]' '[:lower:]' \
  | tr ' ' '\n' | sed 's/^\*\.//' | sort -u > candidates.txt
```

## NOTES

- **State the coverage limit rather than implying completeness.** This finds names in CT plus
  names in your wordlist. A name with no certificate, no A/CNAME, and an unguessed spelling
  stays invisible. Say so in the report — "close to complete but not provably exhaustive"
  is honest and still useful; "here is the zone" is neither.
- **Names in CT but absent from DNS are a finding in their own right** — evidence of prior
  cleanup, and a positive signal about how the zone is maintained. That delta is invisible to
  any live-DNS-only sweep.
- The wildcard pre-check is worth running even when you have API access. It reframes an entire
  audit and costs one query.
- Confirm tool availability *before* scoping work that assumes it. This technique exists
  because an API connector that appeared present turned out not to be reachable mid-audit —
  cheaper to discover in the first minute than the fortieth.
