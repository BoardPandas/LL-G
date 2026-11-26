---
tech: mcp
tags: [mcp, sdk, skills, SkillsExtension, McpServer, low-level-server, resources]
severity: medium
---
# `SkillsExtension.attach` needs an `McpServer`, so a server built on the low-level `Server` must register skills itself

## PROBLEM
The SDK's skills extension (`SkillsExtension` in `@modelcontextprotocol/server` 2.4.0) is attached with `attach(mcp)`. It calls `mcp.isConnected()` and `mcp.registerResource(...)`, which exist on `McpServer` only. `McpServer` builds its own `Server`, so it cannot wrap an existing low-level `Server` (the usual shape of a proxy or gateway that handles `tools/call` itself). Time goes into trying to wrap one in the other, and `attach` also throws if the server is already connected.

## WRONG
```ts
const mcp = new McpServer(info);            // builds its own Server; your low-level one is not used
skills.attach(mcp);
// your gateway's requests never reach these handlers
```

## RIGHT
```ts
// Keep the low-level Server and register the methods yourself.
server.setRequestHandler("skills/list", { params: listParams }, handleSkillsList);
server.setRequestHandler("skills/get", { params: getParams }, handleSkillsGet);
// One resources/read for everything the server serves (skill files, ui:// views).
server.setRequestHandler("resources/read", async (request, ctx) => routeByUri(request.params.uri, ctx));

// Guard against drift with a parity test: same input, compare against the SDK extension.
test("skills/list matches the SDK extension", async () => {
  const reference = await referenceServerWithSkillsExtension(files);
  expect(await ours.call("skills/list")).toEqual(await reference.call("skills/list"));
});
```

## NOTES
- A second `setRequestHandler` for the same method silently replaces the first, so route every resource kind (skill files, `ui://` views) from a single `resources/read` handler.
- The parity test is what makes the copy safe: it fails the day an SDK upgrade changes a field, a limit (512 files, 16 MiB total) or a cache hint.
- Only relay `uri`, `frontmatter` and the manifest from upstream skills; drop other fields.
