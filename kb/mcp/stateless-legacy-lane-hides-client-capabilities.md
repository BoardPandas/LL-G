---
tech: mcp
tags: [mcp, sdk, stateless, initialize, client-capabilities, protocol-era, extensions]
severity: high
---
# In a stateless legacy lane the client's capabilities are unknown, not empty

## PROBLEM
A server that serves 2025-era clients statelessly (no session survives a request) never sees the `initialize` result again: the capabilities the client declared in the handshake are gone by the time a tool handler runs. A 2026-07-28 client sends its capabilities in the request's `_meta` envelope on every request, so those are readable. The two eras therefore need different handling, and a single `capabilities ?? {}` collapses them.

Treating "unknown" as "declared nothing" hides features from clients that support them. Treating it as "declared everything" returns an extension result (a task, an interactive view) to a client that never asked for one and cannot read it. Both fail without an error.

Deciding the era from the presence of the protocol-version header is also wrong: the SDK serves a 2026-07-28 request that omits the header. Use the era the SDK reports to your handler factory.

## WRONG
```ts
function declares(ctx, id: string): boolean {
  const caps = ctx.clientCapabilities ?? {};        // legacy lane: always undefined -> {}
  return caps.extensions?.[id] !== undefined;       // "unknown" silently becomes "no"
}
const era = request.headers.get("mcp-protocol-version") ? "modern" : "legacy"; // header can be absent
```

## RIGHT
```ts
type Caps = { era: "modern" | "legacy"; extensions: Record<string, unknown> | undefined };

function readCaps(ctx, era: "modern" | "legacy" | undefined): Caps {
  if (era !== "modern") return { era: "legacy", extensions: undefined };   // unknown
  const meta = ctx.mcpReq.envelope?.[CLIENT_CAPABILITIES_META_KEY];
  const extensions = isObject(meta) && isObject(meta.extensions) ? meta.extensions : {}; // declared nothing
  return { era: "modern", extensions };
}

// Decide per feature what unknown means. For anything a client must have asked for, unknown is "no".
const canTakeTask = caps.era === "modern" && caps.extensions?.["io.modelcontextprotocol/tasks"] !== undefined;
```

## NOTES
- Keep `undefined` (unknown) distinct from `{}` (declared nothing) in the type, so the compiler forces each caller to choose.
- For opt-in extensions (tasks, UI, elicitation), unknown must mean "do not use it". For purely informational features, unknown can mean "assume the baseline".
- Test both eras through the real handler, not by calling your helper with a hand-built context.
