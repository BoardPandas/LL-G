---
tech: llm-integration
tags: [mcp, json-schema, tool-calling, ajv, validation, schema-drift]
severity: high
---
# A tool-argument type error can be the client, not the parameter

## PROBLEM

A JSON-Schema validation failure on a tool call names a parameter and a type -- `data/requested
must be boolean` -- and the natural reading is "that parameter is wrong." Two different causes
produce a message of exactly that shape, and in neither case is the parameter the problem.

**1. A bound the server enforces but the schema does not publish.** The tool schema says
`note: { type: 'string' }` while the handler validates with `z.string().max(2000)`. An over-long
value looks legal to the caller, is dispatched, and is refused server-side. The rejection can
name a different field or read as a type error, so the caller retries variations of the wrong
argument. An unpublished bound is not a lenient schema; it is a schema that lies by omission.

**2. A client that serializes every tool argument as text.** The schema says `boolean`, the
client sends `"true"`, and the validator correctly refuses. The message names the parameter and
the expected type, which is indistinguishable from the parameter genuinely being wrong.

Cost in the case this came from: four retries against a tool that was working, a confident but
wrong root-cause diagnosis, and two required-boolean tools that were entirely uncallable from
the affected client without anyone noticing.

**Diagnostic tells:**

- The same arguments succeeding from one client and failing from another means client
  serialization, not server logic. A single working client is NOT evidence that the schema or
  server is fine -- that inference is what produced the wrong diagnosis above.
- Grep the error string to find who emitted it. `Invalid arguments for tool ${toolName}` lives
  in `@modelcontextprotocol/server`, so seeing it means the request reached the server and the
  server's validator refused it -- the client did not reject locally.
- Diff every published property against the validator the handler actually runs. Any bound or
  enum present in one and absent from the other is a latent instance of cause 1.

## WRONG

```ts
// Helpers that can only ever emit a type. Bounds and enums live in the API's Zod, unpublished,
// so nothing the caller can read describes what will actually be accepted.
const str = (description: string) => ({ type: 'string', description });
const bool = (description: string) => ({ type: 'boolean', description });

inputSchema: schema(
  {
    id: str('Request id.'),
    requested: bool('True to ask for input, false to clear the flag.'),
    note: str('The question.'), // the API caps this at 2000; the caller cannot know
    size: str('T-shirt size.'), // the API pins this to an enum; the caller has to guess
  },
  ['id', 'requested'],
),

// And the consumer compares against the JSON type it assumed it would get:
body: (args) => (args.requested === true ? { action: 'raise', note: args.note } : { action: 'clear' }),
// `"true" === true` is false, so a raise silently becomes a CLEAR for any client that
// stringifies -- the dangerous failure, because it succeeds.
```

## RIGHT

```ts
// 1. Publish every bound and enum the server enforces, so the caller fails locally with the
//    limit in hand instead of spending a round trip to be told.
note: { type: 'string', description: 'The question.', minLength: 1, maxLength: 2000 },
size: { type: 'string', description: 'T-shirt size.', enum: ['XS', 'S', 'M', 'L', 'XL'] },

// 2. Publish both spellings of a boolean -- as an ENUM, never an open string and never a
//    coercion, so "yes" is refused by the schema rather than quietly meaning false.
requested: {
  anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['true', 'false'] }],
  description: 'True to ask for input, false to clear the flag.',
},

// 3. Narrow ONCE at the dispatcher, keyed on the DECLARED SCHEMA rather than on field names or
//    on the value. Field names drift as tools gain booleans; keying on the value rewrites any
//    string field whose content happens to be "true".
function normalizeArgs(tool: McpTool, args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  for (const [key, property] of Object.entries(tool.inputSchema.properties)) {
    const variants = (property as { anyOf?: readonly { type?: unknown }[] }).anyOf;
    if (!Array.isArray(variants) || !variants.some((v) => v.type === 'boolean')) continue;
    if (out[key] === 'true') out[key] = true;
    else if (out[key] === 'false') out[key] = false;
  }
  return out;
}
```

## NOTES

- **Verify against the validator the server actually runs**, rather than assuming `anyOf` is
  supported end to end. For the TypeScript MCP SDK:
  `new AjvJsonSchemaValidator().getValidator(tool.inputSchema)` from
  `@modelcontextprotocol/server/validators/ajv`. Confirm `true`/`false`/`"true"`/`"false"` all
  pass and that `"yes"` and `1` still reject -- the point is to widen by exactly two values.
- **Required booleans fail loudly; optional ones fail worse.** A required boolean makes the tool
  uncallable, which at least produces an error. An optional one is silently dropped: the call
  succeeds and the field is simply never set, so the caller believes it set something it did not.
- **A tool-list schema is cached at connection time by most clients.** After deploying a schema
  change, a live session keeps serving the old one; reconnect before concluding the fix did not
  land. Fetching a tool's definition and checking for the new constraint is the cheap test.
- Pair this with a test that pins each published bound to its server-side counterpart -- probe
  the validator at the published edge and one past it. A bound that drifts is worse than an
  absent one, because it refuses values the server would have accepted.
