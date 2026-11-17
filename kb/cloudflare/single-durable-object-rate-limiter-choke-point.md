---
tech: cloudflare
tags: [durable-objects, rate-limit, fail-closed, sharding, denial-of-service]
severity: medium
---
# One Durable Object per rate-limit bucket, failing closed, is a global choke point

## PROBLEM
Moving a rate limiter from KV to a Durable Object fixes lost increments, and failing closed fixes "limiter down means no limit". Addressing the object by bucket name alone (`idFromName("login")`) puts every caller of that endpoint through one single-threaded object. Flooding the endpoint saturates it, calls start erroring, and because the helper fails closed every legitimate user is refused too. The attacker never needed to exceed any limit of their own.

## WRONG
```ts
const stub = env.LIMITER.get(env.LIMITER.idFromName(bucket)); // one object for everyone
```

## RIGHT
```ts
// Fixed shard count, chosen by a cheap synchronous hash of the subject, so the same
// subject always lands on the same object and a flood only degrades its own shard.
const SHARDS = 32;
function shardOf(subject: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < subject.length; i++) {
    h = Math.imul(h ^ subject.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0) % SHARDS;
}
const stub = env.LIMITER.get(env.LIMITER.idFromName(`${bucket}#${shardOf(subject)}`));
```

## NOTES
- One object per subject also works but leaves an object behind for every address ever seen unless each one deletes its storage on an alarm.
- Key IP buckets on the IPv6 /64, not the full address, or one host has unlimited subjects.
