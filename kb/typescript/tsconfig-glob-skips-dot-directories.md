---
tech: typescript
tags: [tsconfig, include, glob, dot-directory, type-check, silent-failure, config-files, ci]
severity: high
---
# A tsconfig glob `include` silently skips every dot-directory

## PROBLEM

`include: ["**/*.ts"]` does **not** match anything under a directory whose name
starts with `.`. TypeScript excludes dot-directories from glob expansion by
design, and says nothing about it. The file is simply absent from the program:
no error, no warning, no "0 files matched". `tsc --noEmit` exits 0 having never
parsed it.

This is the fourth distinct shape of "the file is not in the program", and the
nastiest, because the other three have a visible cause in `tsconfig.json` and
this one does not:

- `tsconfig-include-non-source.md` — the include is too broad.
- `tsconfig-exclude-voids-green-gates.md` — the directory is in `exclude`.
- `tsconfig-include-entrypoints-hides-unreferenced-files.md` — the include lists
  entrypoints, so unreferenced files are never reached.
- **this one** — the include IS a recursive glob, the directory is NOT excluded,
  every convention is followed, and the file is still invisible.

It bites config-as-code hardest, because that is what lives in dot-directories:
`.railway/railway.ts`, `.github/` scripts, `.config/*.ts`, `.storybook/main.ts`.
Those files describe deploys and pipelines, so a typo in one is expensive and
lands nowhere near a test.

The trap has a second half. Reaching for a typed config SDK (`railway`,
`@storybook/*`) and telling yourself "now the config is type-checked" is exactly
the reasoning this defeats — the dependency resolves, the editor is happy, and
the CI gate reads nothing. Found live: a `railway` devDependency added
specifically so `.railway/railway.ts` would be checked, where a deliberately
bogus field produced **no error at all**.

## WRONG

```jsonc
// tsconfig.json — .railway/railway.ts is NOT in the program
{
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

```bash
$ pnpm type-check
# exit 0 — and it never opened .railway/railway.ts

$ npx tsc --showConfig | grep '\.railway'
# (no output)
```

## RIGHT

```jsonc
// Name every dot-directory explicitly. A recursive glob will not reach it.
{
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".railway/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

Then prove it, in both directions — presence in the program, and that the gate
actually fails:

```bash
npx tsc --showConfig | grep '\.railway'   # must list the file
# add a bogus field to the config, then:
pnpm type-check                            # must now report TS2353; revert after
```

## NOTES

Same blindness in other tools, so fixing tsconfig alone is not enough:

- **Biome**: `files.includes` needs the dot-path named too, and
  `npx biome check .railway/railway.ts` exits **0** printing
  "These paths were provided but ignored" — green, having read nothing. Check the
  exit code AND the wording.
- **Vitest / Jest**: coverage `include` globs have the same behaviour, so a
  dot-directory contributes nothing to coverage and never appears as 0%.

General rule this is an instance of: whenever you justify a dependency or a
config change on the grounds that "now X is checked", run the check with a
deliberate error before believing it. A tool reporting success is not evidence it
read anything — see also `tsconfig-exclude-voids-green-gates.md`, which reaches
the same conclusion from the `exclude` side.
