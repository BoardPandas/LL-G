---
tech: mcp
tags: [mcp, mcp-apps, security, open-redirect, links, trust-boundary, tool-result]
severity: high
---
# An MCP App view must not decide which links are safe from data in its own tool result

## PROBLEM
A view that renders a tool result often shows "Connect" or "Open" buttons whose URLs come from that result. A natural check is to compare the link with another field in the same payload, for example `link.origin === payload.dashboard_url.origin`. Both fields come from the same source, so a crafted or compromised result (and any result that includes third-party text) supplies a matching pair and vouches for its own link. The check passes for exactly the input it exists to reject.

## WRONG
```ts
// payload = the tool result the view just received
function safeLink(payload, target: string) {
  return new URL(target).origin === new URL(payload.dashboard_url).origin;   // attacker controls both
}
```

## RIGHT
```ts
// The server pins the allowed origin into the HTML when it serves it, from its own configuration.
const html = template.replace("__ALLOWED_ORIGIN__", JSON.stringify(new URL(config.publicUrl).origin));

// In the view: compare only against the pinned value; with no pin, no link is safe.
function safeLink(target: string): string | null {
  const url = parseUrl(target);
  if (!PINNED_ORIGIN || !url || url.origin !== PINNED_ORIGIN) return null;
  return url.href;
}
```

## NOTES
- The pin must come from configuration at serve time, never from a tool result, a query string or a message the view receives.
- If the configuration value is not an `https:` origin, disable the buttons and log a warning at startup rather than falling back to "allow".
- Show the destination host as text next to the button, so it is named even when the host refuses to open the link.
- The general rule: whatever vouches for a payload must come from a different trust domain than the payload.
