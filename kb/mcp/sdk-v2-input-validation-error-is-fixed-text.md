---
tech: mcp
tags: [mcp, sdk, mcpserver, registerTool, inputSchema, validation, zod, standard-schema, error-handling]
severity: medium
---
# SDK v2 tool-input validation failures are fixed text you cannot customize

## PROBLEM
In `@modelcontextprotocol/server` 2.0.0, when `tools/call` arguments fail the registered `inputSchema`, the SDK replies `{ isError: true, content: [{ type: "text", text: "Input validation error: Invalid arguments for tool X: ..." }] }`. There is no machine-readable code and no hint, and `validateToolInput` / `createToolError` are `private` on `McpServer`, so they cannot be overridden. If your tools promise a structured refusal (`{code, message, hint}`) that a model can act on, every schema failure silently breaks that contract, because the bad call never reaches your code.

## WRONG
```ts
server.registerTool("send", { inputSchema: SendArgs }, (args, ctx) => wrap(() => send(args, ctx)));
// invalid args never reach wrap(): the client gets "Input validation error: ..."
```

## RIGHT
```ts
import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";

// Advertise zod's JSON Schema in tools/list, but let every input through to the tool.
function advertised(schema: z.ZodObject): StandardSchemaWithJSON<unknown, unknown> {
  return {
    "~standard": {
      version: 1,
      vendor: "app",
      validate: (value) => ({ value }),
      jsonSchema: schema["~standard"].jsonSchema,
    },
  };
}

function parseArgs<T extends z.ZodObject>(schema: T, args: unknown): z.output<T> {
  const parsed = schema.safeParse(args);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "(arguments)"}: ${i.message}`);
  throw new ToolError("invalid_arguments", "The arguments do not match this tool's input schema.", `Fix and call again: ${problems.join("; ")}.`);
}

server.registerTool("send", { inputSchema: advertised(SendArgs) }, (args, ctx) =>
  wrap(() => send(parseArgs(SendArgs, args), ctx)),
);
```

## NOTES
- `tools/list` still advertises the real schema (property types, `required`), because it is read from `jsonSchema`.
- Report the path and zod's message only; zod's messages describe the expected value and do not echo the received one.
- Verified with zod 4.6.5, 2026-10-12. `wrap()` is the thunk-taking wrapper from `sdk-v2-schemaless-tool-gets-context-first.md`.
