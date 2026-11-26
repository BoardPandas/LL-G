---
tech: mcp
tags: [mcp, mcp-apps, gateway, proxy, sandbox, csp, ui-meta, resources-read]
severity: medium
---
# A relayed MCP App view must not keep the upstream's `_meta.ui.domain`

## PROBLEM
An MCP App view can declare `_meta.ui.domain`, the dedicated origin the host should sandbox it on. The value is only meaningful for the server that wrote it. When a gateway relays the view from `resources/read` unchanged, the host is told to use a domain that belongs to a different server than the connector it is talking to. Hosts that derive the sandbox origin from the connector's own URL then end up with a mismatch: the view renders blank or its requests are blocked by its own sandbox origin. The same applies to any other `_meta.ui` key the gateway did not decide on, such as a CSP list that names hosts it has not vetted.

## WRONG
```ts
// pass the upstream view through as-is
const upstream = await client.readResource({ uri });
return { contents: upstream.contents };   // _meta.ui.domain still names the upstream's origin
```

## RIGHT
```ts
// rebuild _meta.ui from named fields; domain is never one of them
const KEEP = ["csp", "prefersBorder", "preferredDisplayMode"] as const;
function relayView(content) {
  const ui = content._meta?.ui ?? {};
  const kept = Object.fromEntries(KEEP.filter((k) => ui[k] !== undefined).map((k) => [k, ui[k]]));
  return { ...content, _meta: { ui: kept } };      // domain deleted, unknown keys dropped
}
```

## NOTES
- Relayed `csp` entries should be re-checked too: allow `https:` (and `wss:` for connect) public host names only, no IP addresses, no single-label or internal names, no wildcard over a whole public suffix.
- Check the MIME type (`text/html;profile=mcp-app`) before passing a view on.
- Related: a view runs third-party code inside your connector, so treat its `_meta` as untrusted input and rebuild it from an allowlist.
