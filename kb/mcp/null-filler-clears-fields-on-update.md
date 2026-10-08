---
tech: mcp
tags: [mcp, zod, partial-update, null, data-loss, tool-schema]
severity: high
---
# Null filler from MCP clients wipes fields when update tools read null as "clear"

## PROBLEM
Some MCP clients fill every optional argument they cannot omit with `null`, `"null"` or `""`. An update tool ported from an HTTP PATCH route, where `null` means "clear this field", then clears every field the caller never meant to touch: `people_update_deal {id, stage:"won", probability:null, close_date:null, client_id:null, owner_id:null}` wiped five columns in one call, and the audit trail held no old values. A related trap: `z.coerce.number()` turns `null`, `""`, `" "`, `false` and `[]` into `0`, so a blank "amount" books a zero.

## WRONG
```ts
schema: { probability: z.coerce.number().nullable().optional(), close_date: z.string().nullable().optional() }
// handler passes args straight through: null -> column cleared
```

## RIGHT
```ts
const blank = (v: unknown) => v == null || (typeof v === 'string' && (v.trim() === '' || v.trim().toLowerCase() === 'null'));
const optionalNumber = z.preprocess((v) => (blank(v) ? undefined : typeof v === 'string' ? Number(v.trim()) : v), z.number().optional()).optional();
const clear = jsonArray(z.enum(['probability', 'close_date', 'owner_id'])).optional(); // the ONLY way to clear

for (const f of new Set(args.clear ?? [])) {          // dedupe first, or a repeat looks like a conflict
  if (body[f] !== undefined) throw new InputError(`${f} was given a value and also named in clear`);
  body[f] = null;
}
```

## NOTES
Blank means "not supplied" on every create/update tool; clearing is an explicit, enum-limited `clear` list. Keep the advertised JSON Schema type (`number`/`boolean`) and optionality: check with `z.toJSONSchema(z.object(shape), {io:'input'}).required`. Related: [mcp-tool-null-coercion](mcp-tool-null-coercion.md). Found adding CRM CRUD tools to SupportForge (v3.314.0.0).
