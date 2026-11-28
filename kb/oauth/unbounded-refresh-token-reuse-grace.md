---
tech: oauth
tags: [authorization-server, refresh-token, rotation, reuse-detection, grace-period, token-theft, revocation]
severity: high
---
# An unbounded grace for a used refresh token lets a thief holding a stale token mint tokens while the real client is idle

## PROBLEM
With refresh-token rotation, a client whose response was lost in transit retries with the token it just used. Servers add a "grace" so that this retry is not treated as theft. If the grace has no time bound (for example "the previous token stays usable until its successor is used"), a thief holding a stale refresh token can redeem it whenever the real client is idle, and keeps getting fresh tokens. Reuse detection never fires, because the server treats each redemption as a retry.

## WRONG
```text
redeem(refresh_token R1):
  if R1 is used and its successor R2 has not been used yet:
      issue new tokens again          # no time limit: valid for as long as the client stays idle
```

## RIGHT
```text
redeem(refresh_token R1):
  if R1 is used:
      if now - R1.first_used_at <= 60 s:
          revoke the successor R2 AND the access token issued with it
          issue a replacement pair    # a genuine retry of a lost response
      else:
          treat as reuse: revoke the token family
```

## NOTES
- Bound the grace by time from the token's **first use** (60 seconds was used here), not by whether the successor has been used.
- Revoke the access token issued with the superseded successor too; otherwise each use of the grace leaves an extra live access token behind.
- Test with a controllable clock: reuse inside the window succeeds once, reuse after it revokes.
