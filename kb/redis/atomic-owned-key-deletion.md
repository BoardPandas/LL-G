---
tech: redis
tags: [concurrency, ownership, cleanup, lua, request-id, testing]
severity: high
---
# Shared-key ownership checks must be atomic with deletion

## PROBLEM

A request reads its Redis payload, awaits unrelated work, and deletes the key. Another request can replace that shared key in between. The older request then silently removes the newer request's state. Checking a request ID in application code before a separate DEL still leaves this race open.

In SupportForge #298, normal first-attempt launches passed after dispatch ordering was fixed, but an overlapping authentication deleted a newer launch's canonical payload and made its authentication return 404. Existing tests only replaced the payload before authentication began and missed replacement during authentication.

## WRONG

```typescript
const raw = await redis.get(key);
if (raw && JSON.parse(raw).requestId === requestId) {
  await redis.del(key); // Another client can replace the key after GET.
}
```

The same problem affects successful consumption, timeout abandonment and partial-write rollback. A list of keys this request previously wrote does not establish current ownership.

## RIGHT

Compare ownership and delete within one Redis operation. For a JSON payload, a Lua script can check its request ID atomically:

```lua
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, payload = pcall(cjson.decode, raw)
if not ok or type(payload) ~= 'table' then return 0 end
if payload.requestId ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
```

Apply the operation to every shared key shape and every cleanup path. Keep request IDs unique across attempts. Use deterministic tests that replace the payload after the old read has completed and before deletion, including a real consumer paused at an awaited database call. A matching check performed before a later await is not an ownership guarantee.

## NOTES

- [Verified reproduction and patch in SupportForge #298](https://github.com/BoardPandas/supportforge-platform/issues/298#issuecomment-5780480144): 19 existing tests passed; two interleaving regressions failed. The production application correction was still pending when this lesson was recorded.
- Redis documents the same atomic ownership principle for [safe lock release](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/#correct-implementation-with-a-single-instance). That is the shared-key deletion principle used here; adding a distributed lock is not required for this fix.
- This is a runtime concurrency lesson, not an agent-configuration defect. No configuration eval is appropriate.
