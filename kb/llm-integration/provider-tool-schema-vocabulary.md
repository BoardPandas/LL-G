---
tech: llm-integration
tags: [tool-calling, json-schema, gemini, function-declarations, zod, schema-validation]
severity: high
---
# A provider's function-calling schema is a narrower vocabulary, and it 400s rather than ignoring

## PROBLEM
Tool definitions are usually generated once -- `zod-to-json-schema`, `z.toJSONSchema`,
pydantic's `model_json_schema()` -- and handed to every provider. The output is valid
JSON Schema, so it looks provider-neutral.

It is not. Anthropic and OpenAI accept broadly the full draft vocabulary. **Gemini's
`FunctionDeclaration` takes an OpenAPI-derived `Schema`, a strictly smaller set**, and a
keyword outside it is not ignored -- it rejects the entire request:

```
Invalid JSON payload received. Unknown name "propertyNames" at
'tools[0].function_declarations[0].parameters.properties[2].value': Cannot find field.
```

Three properties make this much worse than a normal 400:

- **The tool list is sent on every turn.** This is not one broken tool call; it is every
  request failing, including the first. The agent is completely dead on that provider.
- **One tool poisons all of them.** A single `z.record()` in one of hundreds of tools
  emits `propertyNames` and takes the whole catalogue down.
- **Nothing local catches it.** Typecheck, unit tests and the other providers all stay
  green. The schema is valid; it is valid for the wrong vocabulary.

**The error names only some of the violations.** A real case: the reported failure listed
`propertyNames` across eight tools. Fixing exactly that keyword produced a fresh 400 --
`additionalProperties` and `exclusiveMinimum` were also unsupported and simply had not
been reached. Fixing the named keyword moves the error; it does not clear it.

Generators emit these constantly without anyone writing them by hand:
`z.record()` → `propertyNames`; every object → `additionalProperties`; `z.number().gt()`
→ `exclusiveMinimum`; every root → `$schema`.

## WRONG
```ts
// Generated once, forwarded verbatim. Fine on Anthropic and OpenAI; 400 on Gemini.
const functionDeclarations = tools.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: {
    type: Type.OBJECT,
    properties: t.inputSchema.properties,   // draft-7, straight through
    required: t.inputSchema.required,
  },
}));

// ...and the reflex fix, which is also wrong: deleting the keyword the error named.
function stripPropertyNames(schema: any) {
  delete schema.propertyNames;              // next request 400s on additionalProperties
  return schema;
}
```

## RIGHT
```ts
// Allowlist the vocabulary the provider models. Not a blocklist of what bit you:
// the generator may emit anything the spec permits, and a keyword nobody has
// written yet should degrade to a missing constraint, never a 400 on every turn.
const GEMINI_SUPPORTED = new Set([
  'type', 'format', 'title', 'description', 'nullable', 'enum', 'default', 'example',
  'properties', 'required', 'minProperties', 'maxProperties',
  'items', 'minItems', 'maxItems',
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'anyOf', 'propertyOrdering',
]);

export function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!GEMINI_SUPPORTED.has(key)) continue;
    // Recurse through EVERY subschema-valued keyword, or the survivors hide
    // one level down: properties (a map), items (a schema), anyOf (a list).
    if (key === 'properties' && value && typeof value === 'object') {
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitize(v)]),
      );
    } else if (key === 'anyOf' && Array.isArray(value)) out[key] = value.map(sanitize);
    else if (key === 'items') out[key] = sanitize(value);
    else out[key] = value;
  }
  return out;
}
```

## NOTES
- **Verify against the real corpus, not a fixture.** Extract every generated tool schema
  and post the whole list to the provider. One call answers it: raw returned 400 naming
  three keywords across 348 tools, sanitized returned 200. A handful of hand-written
  example schemas would have missed two of the three.
- **Dropping unlisted keywords is only safe while schemas are self-contained.** `$ref`
  and `$defs` would be dropped too, leaving an *empty* schema the provider happily
  accepts and the model cannot use -- a silent quality loss instead of a loud failure.
  Check that none appear before trusting an allowlist, and inline them if they do.
- **Guard it, because the next tool re-breaks it.** A check that runs every generated
  schema through the sanitizer and asserts only supported keywords survive catches it
  offline. Make it assert its own coverage first: registration that silently yields zero
  tools makes every other assertion pass for free.
- Anthropic's `input_schema` and OpenAI's `parameters` are far more permissive, so this
  surfaces the moment someone selects the stricter provider -- often long after the tool
  that introduced the keyword was merged and reviewed.
- Same shape, other providers: Bedrock Converse and Vertex constrain tool schemas too.
  Assume the intersection is smaller than any one provider's documentation suggests.
