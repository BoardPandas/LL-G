---
tech: tls
tags: [lets-encrypt, acme, lego, dns-01, propagation, nxdomain, negative-cache, renewal, hooks]
severity: medium
---
# lego 5: the recursive DNS propagation check asks the system resolver, which has cached the NXDOMAIN from just before the TXT record existed

## PROBLEM
For a DNS-01 challenge, lego creates the `_acme-challenge` TXT record and then waits until it can see the record before telling the CA to validate. Part of that wait is a check through the **system's recursive resolver**. The resolver was asked for the same name moments earlier, before the record existed, and cached the NXDOMAIN (negative caching). It keeps answering NXDOMAIN from its cache, so lego never sees the record and issuance fails after the **whole** propagation wait, although the record is correct on the authoritative servers.

Separately, lego 5 renamed flags, so a script written for an earlier major version fails or silently does something else.

## WRONG
```text
- Run a DNS-01 issuance with the default propagation check: it includes the recursive
  resolver, waits the full timeout, then fails.
- Reuse a script written for an earlier lego: --days, --run-hook.
```

## RIGHT
```text
- Add --dns.propagation.disable-rns so propagation is checked at the authoritative
  name servers only.
- Use the lego 5 names (table below).
```

lego 5 changes:

| Earlier | lego 5 |
|---|---|
| a separate step to renew | `run` also renews |
| `--days` | `--renew-days` |
| `--run-hook` | `--deploy-hook` |
| (hook variables) | `LEGO_HOOK_CERT_PATH`, `LEGO_HOOK_CERT_KEY_PATH` |

## NOTES
- Symptom: the TXT record is visible with `dig @<authoritative-ns>` while lego keeps waiting.
- Check the exact flag placement against `lego --help` for your version; the table lists the renames, not a full command reference.
- Related: `kb/dns/authoritative-nxdomain-recon.md` for querying authoritative servers directly.
