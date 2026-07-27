---
tech: cloudflare
tags: [cloudflare-one, warp, zero-trust, split-tunnel, hostname-routes, tunnel, entra, conditional-access, blast-radius]
severity: high
---
# Public hostname routes are account-wide, not device-profile-scoped

## PROBLEM
A Cloudflare Tunnel **public hostname route** applies to every WARP / Cloudflare One client in the account, not just the users matched by the device profile you created alongside it. There is no profile field on the route.

What actually gates whether a given client follows the route is Split Tunnels. Gateway resolves a routed hostname to a synthetic IP in `100.80.0.0/16` (CGNAT); when a packet's destination lands in that range, Gateway sends it down the matching tunnel. So any profile whose Split Tunnel config tunnels `100.80.0.0/16` follows every hostname route in the account.

In **Exclude** mode, `100.64.0.0/10` is the default exclusion that prevents this. If someone previously emptied the default profile's exclude list (a common fix for reaching private CGNAT / RFC1918 ranges), the whole fleet silently tunnels `100.80.0.0/16` and inherits every hostname route.

This is hard to debug for two reasons:

- The intended scoping mechanisms (a user-scoped device profile, a user-scoped Conditional Access policy) look correct and *are* correct for what they govern, so design review passes.
- Nothing errors. Routing an identity provider's auth endpoint (`login.microsoftonline.com`) still authenticates fine, so Entra sign-in logs report `errorCode 0` and `conditionalAccessStatus: success` on every attempt.

The failure surfaces in the relying party instead. Multi-hop app sign-ins break when only the login hostname is routed. Azure DevOps goes `dev.azure.com` then `login.microsoftonline.com` then `vssps.dev.azure.com`; with only the middle leg routed, the auth leg egresses from the tunnel IP while the app legs egress normally, session establishment fails on the mismatch, and the app redirects back to login forever. The result is an infinite login loop with a 100 percent success sign-in log and one interactive sign-in per second.

A tunnel with multiple connectors makes it worse: each connector has its own public IP and Cloudflare load-balances across them, so even the routed leg is not IP-stable within a single flow.

## WRONG
```bash
# Create a hostname route, then "scope the pilot" with a device profile.
# The device profile scopes NOTHING about the route.
curl -X POST ".../accounts/$ACCT/zerotrust/routes/hostname" \
  -d '{"hostname":"login.microsoftonline.com","tunnel_id":"'"$TUNNEL"'"}'

curl -X POST ".../accounts/$ACCT/devices/policy" \
  -d '{"name":"PILOT","match":"identity.email in {\"a@x.com\" \"b@x.com\"}"}'

# Meanwhile the fleet DEFAULT profile had its exclude list emptied
# earlier so users could reach 10.0.0.0/8:
#   excludeList: []            <- no 100.64.0.0/10
# => every WARP user in the account tunnels 100.80.0.0/16
#    and follows the "pilot" route.
```

## RIGHT
```bash
# 1. BEFORE creating any hostname route, inspect the DEFAULT profile's
#    exclude list. This, not the pilot profile, decides blast radius.
curl ".../accounts/$ACCT/devices/policy/exclude" | jq '[.result[].address]'

#    If 100.64.0.0/10 is absent, the entire fleet will follow every
#    hostname route. Re-add it to the default profile and add back only
#    the narrower ranges actually needed, leaving 100.80.0.0/16 tunneled
#    ONLY in the pilot profile.

# 2. Route every hostname the app's auth flow touches, not just the IdP.
#    Azure DevOps needs dev.azure.com AND vssps.dev.azure.com, not just
#    login.*. Routing a subset splits one flow across two egress
#    identities and loops.

# 3. Prefer a single connector (or one shared NAT egress) so the routed
#    leg has a stable source IP across redirects.

# 4. Verify blast radius empirically instead of trusting the scoping:
#    pull sign-in logs filtered to the tunnel egress IPs and confirm
#    ONLY the pilot users appear.
```

## NOTES
- Enumerate and delete routes at `/accounts/{account_id}/zerotrust/routes/hostname[/{id}]`. This path is missing from the Cloudflare OpenAPI spec's searchable summaries, so keyword endpoint-guessing fails. `teamnet/routes` is a different resource (private network routes) and will not list hostname routes.
- `exclude_office_ips: true` on a profile does NOT protect against this. It excludes Microsoft's real published IP ranges, while hostname routes resolve to synthetic `100.80.0.0/16` addresses that are not in that list.
- Diagnostic signature: interactive sign-ins repeating about once per second with `errorCode 0`, `isInteractive: true`, and zero CA policy failures means the IdP is healthy and the relying party is discarding the session. Investigate the egress path, not cookies, cache, or Credential Manager. Clearing browser state and rebooting both fail to fix it.
- Isolate the variable with a same-user, same-day, before-and-after comparison across the moment the route went live. That separates egress changes from coincident browser or agent updates.
- Deleting the routes is the fleet-wide lever. Deleting the pilot device profile only reverts the pilot users and leaves everyone else broken.
- If the routed IdP endpoints back a Conditional Access named location, delete the CA policy before the named location, and do not enable such a policy after removing the routes: no one egresses from those IPs anymore, so enforcement would block every targeted user.
