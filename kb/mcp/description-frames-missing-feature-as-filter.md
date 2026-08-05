---
tech: mcp
tags: [tool-description, discoverability, missing-capability, api-surface, silent-gap]
severity: medium
---
# A tool description that calls a missing feature a filter hides the gap

## PROBLEM
The wording of a tool description decides what a reader concludes when something
is absent. "Side-conversation mail is excluded by default" describes a filter, so
every reader -- human or model -- goes looking for the parameter that turns it
off. There was no parameter. There was also no other tool: that capability had
never been built on the MCP surface at all.

"By default" is the whole problem. It asserts a switchable default and therefore
quietly promises a switch. A reader who trusts it stops at "I cannot find the
flag" instead of reaching "this feature does not exist here", and then reports a
limitation of their own searching rather than a gap in the product.

What makes the wording load-bearing is that everything else looked complete. The
underlying data had shipped long ago -- table, foreign key, service layer, REST
route, and a working dashboard UI reading all of it. Only the MCP tool was
missing. No other angle on the system showed anything wrong, so the description
was the single place that gap was ever going to surface, and it described the gap
as a setting.

## WRONG
```ts
mcp.tool(
  'get_ticket_messages',
  'The conversation timeline for a ticket. ' +
  'Side-conversation mail is excluded by default.',  // implies a flag exists
  { ticket: z.union([z.number(), z.string()]) },     // ...no such flag, no such tool
  handler
)
```

## RIGHT
```ts
// State what this tool covers, that the other data is a separate timeline, and
// name the tool that reads it. When no such tool exists, that last clause is
// unwritable -- which is the moment the gap gets found.
mcp.tool(
  'get_ticket_messages',
  'The requester-facing conversation timeline for a ticket. ' +
  'Private third-party (side-conversation) mail is never included here -- call ' +
  'get_ticket_side_conversations as well before concluding a ticket has no ' +
  'external correspondence.',
  { ticket: z.union([z.number(), z.string()]) },
  handler
)
```

## NOTES
- Audit rule: grep tool descriptions for "by default", "excluded", "not
  included", and "unless". Each hit must either name the parameter that changes
  the behaviour or name the tool that provides it. If it can do neither, it is
  documenting a missing feature as a setting.
- The check is mechanical and local: does a parameter with that name exist in the
  same schema? A description promising a toggle that is absent from its own input
  schema is a contradiction visible without leaving the file, which makes it
  cheap to lint.
- This is the description-level twin of [[missing-tool-vs-missing-capability]].
  There the tool exists but is never advertised in tools/list; here the
  advertised text implies a capability that was never implemented. Both end with
  a caller concluding "unavailable" for the wrong reason, and both are resolved
  the same way -- enumerate what the backend can actually do instead of trusting
  the surface.
- Applies to any generated API surface, not only MCP. An OpenAPI `summary` or a
  CLI `--help` line makes the identical promise with the identical consequence.
