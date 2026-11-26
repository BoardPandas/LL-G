---
tech: mcp
tags: [mcp-apps, ui-domain, claude, sandbox-origin, connector-url, views]
severity: medium
---
# Do not set `_meta.ui.domain` on an MCP App view that does not need a fixed origin

## PROBLEM
An MCP App resource may set `_meta.ui.domain` to ask the host for a stable sandbox origin. Claude's connector documentation gives the required value as the first 32 hex characters of SHA-256 over the connector's URL, followed by `.claudemcpcontent.com`, and says a value that does not match makes Claude show an error in place of the view.

The hash covers the URL exactly as the person added the connector. The server cannot know that string: a trailing slash, a different host name for the same server, or a gateway relaying the server all produce a different hash from the one the server computes from its own configuration. Setting the field "to be complete" therefore adds a way for the view to fail and gives nothing back unless the view needs a stable origin.

A view needs a stable origin only to keep cookies or browser storage, or to run its own sign-in flow. A view that gets all its data through tool calls needs none.

## WRONG
```ts
contents: [{
  uri, mimeType: 'text/html;profile=mcp-app', text: html,
  _meta: { ui: { csp: {}, domain: `${sha256(serverUrlFromConfig).slice(0, 32)}.claudemcpcontent.com` } },
}]
```

## RIGHT
```ts
contents: [{
  uri, mimeType: 'text/html;profile=mcp-app', text: html,
  _meta: { ui: { csp: {}, prefersBorder: false } },   // no domain: the host assigns the origin
}]

// Pin the absence, so nobody adds it back for completeness.
expect(Object.keys(item._meta.ui).sort()).toEqual(['csp', 'prefersBorder']);
```

## NOTES
- This is from Claude's documentation, not from an observed failure: the rule was applied before the view was tried in a live client.
- If a view does need the origin, document that the connector must be added with exactly the URL the server hashes, and test the hash against the documentation's example.
- Related: a gateway relaying a view must drop the upstream's value (`relayed-mcp-app-ui-domain-is-wrong-behind-a-gateway.md`).
