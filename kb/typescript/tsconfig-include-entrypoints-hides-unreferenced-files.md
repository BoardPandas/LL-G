---
tech: typescript
tags: [tsconfig, include, typecheck, module-graph, dead-code, gates, monorepo]
severity: high
---
# An entrypoint-style tsconfig `include` leaves any file nothing imports completely unchecked

## PROBLEM

A tsconfig whose `include` lists **entrypoints** rather than globs is a
deliberate and common pattern — it keeps the program small and fast, and every
real file is reached transitively through an import:

```jsonc
"include": ["src/server.ts", "src/ws-server.ts", "src/routes/**/*.ts"]
```

The consequence is rarely stated: **a file no entrypoint transitively imports is
not in the program at all.** `tsc --noEmit` does not check it, does not parse it,
and reports success. The file can contain any error whatsoever.

This is not the same as an excluded directory, and it is not a too-broad
`include`. The file sits in `src/`, matches the project's conventions, is
committed, is covered by lint, and may even have a green test suite — because
Jest compiles per-file via its own transform and never consults the program
`tsc` built.

It bites hardest exactly when it matters most: **new modules written before
they are wired in.** Two halves of one feature, authored in parallel against a
shared interface, can each be internally consistent and mutually incompatible,
and `tsc` will not compare them, because neither is reachable. The moment
someone wires them together the errors all arrive at once — or worse, the shapes
are loose enough to compile and the mismatch becomes a runtime bug.

Observed: two modules implementing and consuming the same interface with the
arguments in opposite orders — `dispatch(payload, targets)` versus
`dispatch(targets, payload)`. Clean `tsc`, 2770 passing tests, and the defect
was structurally invisible because nothing imported the implementation.

## WRONG

```bash
# Reported clean. Proves nothing about src/rmm/notifications/channels/**,
# which no entrypoint imports.
npx tsc --noEmit -p tsconfig.json
```

```ts
// src/rmm/notifications/channels/dispatcher.ts
// Never type-checked. Nothing imports it yet.
export function createChannelDispatcher(opts: Options): ChannelDispatcher {
  return {
    async dispatch(targets, payload) { /* argument order is wrong; nobody knows */ }
  };
}
```

## RIGHT

Probe reachability before trusting a green typecheck on any new module. Insert a
deliberate error and confirm the compiler reports it:

```bash
printf '\nconst __reach: string = 42;\n' >> src/path/to/new-module.ts
npx tsc --noEmit -p tsconfig.json    # MUST report TS2322 at that line
git checkout src/path/to/new-module.ts
```

Silence means the file is not in the program, and your green gate covered
nothing. Fix it by making the module genuinely reachable — a value import from
something an entrypoint already reaches, which is usually the wiring you were
going to write anyway:

```ts
// src/rmm/notifications/index.ts  (reached from src/routes/**)
import { createChannelDispatcher } from './channels';   // value import, not `import type`

export function createDefaultChannelDispatcher(): ChannelDispatcher {
  return createChannelDispatcher({ senders: { email, webhook } });
}
```

A type-only import is not enough to make the whole module graph meaningful for
runtime wiring, but it does pull the file into the program; a value import does
both. After wiring, re-run the probe and confirm it now errors.

## NOTES

- **`tsc` exiting 0 is a statement about the program it built, not about your
  repository.** Ask which program a file is in before treating a green run as
  coverage of it.
- List the program's files when unsure: `npx tsc -p tsconfig.json --listFiles`
  and grep for the path. Cheaper than the probe, though the probe is what proves
  the gate is live.
- Jest passing is not a counter-signal. `ts-jest`/`babel-jest` compile each test's
  own import graph in isolation and never see the project program, so a file can
  be exercised by tests and still be absent from `tsc`.
- Lint is not a counter-signal either — ESLint walks the filesystem, not the
  module graph, so a warning count of zero on an unreachable file is expected.
- The same reasoning applies to a monorepo package that nothing depends on yet:
  it is checked only when its own `tsconfig` is built, not by the app's.
- Related and distinct: `tsconfig-include-non-source.md` (include too broad,
  pulling in scratch files) and `tsconfig-exclude-voids-green-gates.md` (an
  excluded directory passing both gates for free). This entry is the third
  shape — inside `src`, not excluded, and still unchecked, purely because no
  entrypoint reaches it.
