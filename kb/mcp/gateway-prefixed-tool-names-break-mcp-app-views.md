---
tech: mcp
tags: [mcp, mcp-apps, gateway, proxy, tool-names, callServerTool, ui-resource]
severity: high
---
# A gateway that renames a tool breaks an MCP App view that calls it by its original name

## PROBLEM
An MCP App view (an HTML page served from a `ui://` resource) runs in the host and calls tools with `callServerTool({ name })`, using the name its own server gave the tool. A gateway that aggregates several servers usually lists their tools as `<toolkit>__<tool>` to keep names unique. The host's tool list then shows the prefixed name, the view calls the bare name, and the gateway answers "unknown tool". Nothing is wrong in either server, and listing and rendering both work; only the first click inside the view fails.

A name that contains `__` has a second problem: hosts that list an app as an entry point skip tools with such names (see the related entry on entry-point conditions).

## WRONG
```ts
// tools/list: every upstream tool is renamed, including the one that carries a view
tools.push({ ...tool, name: `${toolkit}__${tool.name}` });

// tools/call: only the prefixed form resolves
const [toolkit, name] = request.params.name.split("__");
// the view calls "show_dashboard" -> no match -> unknown tool
```

## RIGHT
```ts
// List the view-carrying tool under the name its server gave it, and remember who owns the name.
const owners = new Map<string, string>(); // name -> toolkit, kept per user
for (const { toolkit, tool } of appTools) {
  if (!isSafeName(tool.name) || owners.has(tool.name)) continue; // ambiguous or unusable: keep the prefixed form
  owners.set(tool.name, toolkit);
  promoted.push({ ...tool, name: tool.name, _meta: rebuildMeta(tool._meta) });
}

// tools/call: bare name first (what a view sends), then the prefixed form
const toolkit = owners.get(name) ?? parsePrefixed(name)?.toolkit;
```

## NOTES
- Promote only tools that carry a view; leave every other tool prefixed.
- A promoted name must be safe as an entry point: letters, digits, `_` and `-`, a bounded length, and no `__`.
- Two toolkits offering the same bare name must not both resolve. Refuse the call as ambiguous, or keep the name with whoever already held it (see the entry on name ownership across requests).
- Only serve bare-name calls to callers that were shown the promoted list; an older client that only knows prefixed names should keep getting prefixed ones.
