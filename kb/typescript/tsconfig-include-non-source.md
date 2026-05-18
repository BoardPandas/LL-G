---
tech: typescript
tags: [tsconfig, include, exclude, tsc, next-build, typecheck]
severity: high
---
# A broad tsconfig `include` with only node_modules excluded type-checks scratch/template files anywhere in the repo

## PROBLEM
`tsc --noEmit` (and `next build`, which runs the type checker) compiles every file matched by `include` minus `exclude`. A common starter config sets `include: ["**/*.ts", "**/*.tsx"]` and `exclude: ["node_modules"]`. That glob reaches into ANY directory in the repo: handoff folders, scratch dirs, doc examples, or `tasks/` plan attachments that contain reference `.tsx` files. Those files are never imported and are not real source, but they are still type-checked. A single non-compiling template file there fails the whole typecheck and breaks `next build`, with an error pointing at a file no one considers "code". It is confusing because the failing file is not in `src/` and was never wired into the app.

## WRONG
```jsonc
// tsconfig.json -- include reaches tasks/handoff/*.tsx, docs/**, scratch/**
{
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

## RIGHT
```jsonc
// tsconfig.json -- scope include to real source, exclude non-source dirs
{
  "include": ["src/**/*.ts", "src/**/*.tsx", "next-env.d.ts"],
  "exclude": ["node_modules", "tasks", "docs", "old-site"]
}
```

## NOTES
Either narrow `include` to real source roots, or add every non-source directory to `exclude`. Excluding is the safer retrofit because it does not risk dropping a legitimate source path. Symptom: `next build` or `pnpm type-check` fails on a `.tsx` file under `tasks/`, `docs/`, or similar that you never intended to ship.
