---
tech: typescript
tags: [zod, tsc, oom, ts2589, duplicate-dependency, npm-workspaces, conditional-types, mcp-sdk, monorepo]
severity: high
---
# tsc OOM on zod-heavy files is usually TWO COPIES of zod, not heap size

## PROBLEM

`tsc --noEmit` exhausts the heap and dies on a package full of zod schemas.
Raising `--max-old-space-size` does not help, even at 16 GB. Narrowing the
`include` surfaces `TS2589: Type instantiation is excessively deep and possibly
infinite` pointing at one of **your own** generic types.

Both signals misdirect. The heap is not too small and your generic is usually
innocent. The real cause is **two copies of zod in one TypeScript program**.

This happens whenever a library bridges zod v3 and v4 with a conditional type.
The MCP SDK (`@modelcontextprotocol/sdk`, v1.29+) is the common case:

```ts
// node_modules/@modelcontextprotocol/sdk/dist/*/server/zod-compat.d.ts
import type * as z3 from 'zod/v3';
import type * as z4 from 'zod/v4/core';
export type SchemaOutput<S> =
  S extends z3.ZodTypeAny ? z3.infer<S>
  : S extends z4.$ZodType ? z4.output<S>
  : never;
```

If your package pins `zod@^3` (npm nests it under `packages/<pkg>/node_modules/zod`)
while the hoisted SDK resolves `zod/v3` + `zod/v4/core` to a root `zod@^4`, then
every schema forces TypeScript to structurally compare a `ZodObject` from copy A
against two deeply recursive type graphs from copy B. Nominally distinct,
structurally enormous. The work is **unbounded**, which is exactly why more heap
never helps.

Why this is HIGH and not just a slow build: the accepted workaround for the
symptom is "build with esbuild, which strips types without checking them." Do
that and **no type error in the package is ever reported again**. One real
codebase had ~290 files and 9 latent type errors sitting uncaught behind it.

## WRONG

```bash
# 1. Blame the heap. Never works -- the instantiation is unbounded, not large.
NODE_OPTIONS=--max-old-space-size=16384 tsc --noEmit   # still OOMs

# 2. Blame your own generic, because TS2589 points at it.
#    Rewriting this changes nothing; the explosion is inside the SDK's conditional.
export interface ToolDefinition<T extends z.ZodType<any, any>> {
  handler: ToolCallback<{ [key: string]: T }>;   // <- TS2589 lands here, innocent
}

# 3. Give up and let esbuild strip types. Now the package is NEVER type-checked.
"build": "esbuild src/index.ts --bundle ..."      # and no "typecheck" script
```

## RIGHT

```bash
# STEP 1 -- prove it is duplication, not your code. Write a probe with NO generics:
#   type P = ToolCallback<{ params: z.ZodObject<{ id: z.ZodString }> }>;
# If that alone OOMs, the problem is not your generic.

# STEP 2 -- count zod copies. This is the whole diagnosis, in one command:
find . -name package.json -path '*/node_modules/zod/package.json' \
  -not -path '*/node_modules/*/node_modules/*/node_modules/*' \
  | while read f; do echo "$f -> $(node -p "require('./$f').version")"; done
# packages/foo-mcp/node_modules/zod -> 3.25.76     <- nested copy
# node_modules/zod                  -> 4.4.3       <- hoisted copy   ** BOTH in one program **

# STEP 3 -- confirm both are really in the program:
tsc --noEmit -p tsconfig.json --traceResolution 2>&1 | grep -i "zod/v[34]" | sort -u
# ...zod/v4/core/api.d.cts@4.4.3   AND   ...zod/v4/core/api.d.ts@3.25.76

# STEP 4 -- dedupe to ONE copy, then re-check. Align the outlier package's pin
# with the rest of the workspace (here: zod ^4.4.3) and reinstall.
```

```jsonc
// packages/foo-mcp/package.json -- align the pin AND add the script that would
// have caught this on day one.
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle ...",
    "typecheck": "tsc --noEmit"          // <- esbuild does NOT type-check. Add this.
  },
  "dependencies": {
    "zod": "^4.4.3",                      // was ^3.24.2 -> nested duplicate
    "@modelcontextprotocol/sdk": "^1.29.0"
  }
}
```

Measured result on a real 290-file package: full `tsc --noEmit` went from
**OOM at 16 GB** to **exit 0 in 1.7 s / 522 MB peak RSS**. No source-level type
gymnastics were needed.

## NOTES

- **Refines [tsc runs out of heap compiling many zod-heavy files](tsc-oom-zod-heavy-use-esbuild.md)** (MEDIUM).
  That entry records the symptom and recommends esbuild. Check for duplicate zod
  copies FIRST -- if that is the cause, you keep type-checking instead of
  permanently disabling it. Reach for esbuild-only as a last resort.
- **Can't upgrade to v4?** You do not have to migrate the API. Depend on `zod@^4`
  and import from `zod/v3` -- zod 4 ships the complete v3 implementation at that
  subpath, so runtime behavior is byte-identical while the program collapses to
  one copy. Verified: the same probe compiles in 0.47 s either way.
- **zod 3 -> 4 migration surface is usually tiny.** In a 290-file package only two
  things broke: `z.record(z.any())` needs an explicit key type in v4
  (`z.record(z.string(), z.any())`), and that's it. `z.ZodIssueCode.custom`,
  `superRefine`/`ctx.addIssue`, `.passthrough()`, `.catch()`, `.describe()`,
  `.optional()`, `.min()`, `z.union`, `z.infer` all carry over unchanged.
  See [Zod z.object() strips undeclared keys](zod-object-strips-undeclared-keys.md)
  for a separate v3/v4-agnostic trap.
- **Generalizes past zod.** Any dual-version compat shim (`X extends v3.Foo ? ... :
  X extends v4.Bar ? ...`) over a recursively-typed library will do this when two
  copies coexist. Suspect it whenever TS2589 appears in a monorepo where one
  package's dependency pin diverges from its siblings.
- **After deduping, verify runtime, not just types.** If the package builds with
  esbuild it has never been type-checked, so a major-version bump ships unverified.
  Register your schemas against a real server over an in-memory transport and diff
  the generated JSON Schema before and after.
