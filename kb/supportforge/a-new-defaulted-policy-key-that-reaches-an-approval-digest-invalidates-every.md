---
tech: supportforge
tags: [digest, approvals, policy, rmm, patching, deploy, allowlist]
severity: high
---
# A new defaulted policy key that reaches an approval digest invalidates every standing approval on deploy

## PROBLEM
Adding a key with a default to a policy object that is hashed into an approval binding digest changes the digest for every existing approval, so on the next read each one flips to `invalidated` fleet-wide.
Nothing fails at build or test time. Unit tests build fresh approvals, which carry the new digest. The breakage shows only in production, against approvals written before the deploy. In the patch binding the digest hashed `PatchingPolicyValues` minus a denylist, so every new key a feature added (schedule, reboot, approval-rule keys) would have moved it. The same applies to a per-job execution digest: confirmed jobs in flight at deploy go stale at lease time.

## WRONG
```ts
// Denylist: every key added later is hashed by default.
function digestSafePolicy(policy: PatchingPolicyValues) {
  const { autoApprove, autoApproveAfterDays, ...rest } = policy;
  return rest;
}
const policyDigest = canonicalDigest({ policy, rings });
```

## RIGHT
```ts
// Allowlist of exactly the keys this digest format has always covered.
const DIGESTED_POLICY_KEYS = ['cadence', 'windowDay', /* ... */] as const;
function digestSafePolicy(policy: PatchingPolicyValues) {
  return pickPresent(policy, DIGESTED_POLICY_KEYS);
}

// For a digest that SHOULD cover future keys: include a new key only once it
// differs from its default, so deploying the key itself moves nothing.
function executionDigestPolicy(policy: PatchingPolicyValues) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(policy)) {
    const def = SECTION.keys[key]?.defaultValue;
    if (PRE_EXISTING_KEYS.has(key) || canonicalJson(value) !== canonicalJson(def)) out[key] = value;
  }
  return out;
}
```

## NOTES
Pin it with a test: compute the digest for a policy carrying every new key at a non-default value plus any new catalog field, and assert it equals the digest computed without them. A key that genuinely should invalidate approvals belongs in the allowlist together with a digest version bump. The same allowlist rule applies to catalog rows fed into the digest: a new column read into the row type moves it too.
