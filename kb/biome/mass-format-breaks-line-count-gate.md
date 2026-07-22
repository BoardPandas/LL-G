---
tech: biome
tags: [formatter, indentStyle, ci, line-cap, mass-reformat, vendored, generated, blast-radius]
severity: medium
---
# A repo-wide formatter run reflows enough lines to break an unrelated CI gate

## PROBLEM

Running the repo's own `lint:fix` looks like the safest possible first move on a lint backlog. It is not, when the formatter's configured style disagrees with how a large part of the tree was actually written -- because then it is not a formatting touch-up, it is a rewrite of every line in those files.

Two things follow, neither obvious:

1. **The diff is enormous.** One `biome check --write` reformatted **948 files, +99k/-62k lines**, because `dashboard/src/public/**` had been written with 2-space indentation while `biome.jsonc` declared `"indentStyle": "tab"`. Nobody noticed the drift for months, because lint was never gated in CI. Git blame for those files is now the reformat commit.
2. **Line counts jump, and something else may be enforcing them.** Tab conversion plus import re-wrapping at `lineWidth: 100` inflated files by 10-50%. That pushed **42 files past a hard 500-line cap** enforced by a `check:linecap` script as a *fail-fast* CI step. The cap gate was green before and red after, from a change containing no logic at all.

The second one is the real trap: the gate that breaks has nothing to do with linting, so it is not on your radar when you decide to run the formatter.

There is a third, quieter hazard in the same pass: mass formatting will happily rewrite **vendored and generated files** if they sit inside the configured include globs -- minified bundles, verbatim upstream library builds, code-generated tables. Those produce findings that cannot be fixed without either diverging from upstream or being clobbered on the next regeneration.

## WRONG

```bash
# Opening move on a lint backlog.
pnpm run lint:fix          # biome check --write .
# Checked 1207 files. Fixed 947 files.
# -> 948 files changed, +99144 -62092
# -> check:linecap: FAILED, 42 files over 500 lines   (CI fail-fast step, now red)
```

## RIGHT

```bash
# 1. Measure the blast radius BEFORE writing anything.
biome check . --max-diagnostics=20000 2>&1 | grep -cE '^[^ ]+ format'
git ls-files '*.ts' '*.js' | head -50 | xargs -I{} sh -c 'head -3 {} | grep -qP "^\t" || echo "space-indented: {}"'
#   many hits => config and tree disagree; this is a rewrite, not a touch-up

# 2. Record every count-based gate's state first, so you can attribute a break.
pnpm run check:linecap        # green BEFORE
git ls-files '*.ts' '*.js' | xargs wc -l | awk '$1>450 && $2!="total"'   # who is near the cap

# 3. Exclude vendored + generated files from the formatter's scope FIRST.
#    (in biome.jsonc files.includes, negated globs)
#      "!dashboard/src/public/sw.js",            // emitted by scripts/generate-sw.mjs
#      "!dashboard/src/public/workbox-*.js",     // vendored Workbox bundle
#      "!dashboard/src/public/shared/idb.js",    // verbatim idb build output
#      "!dashboard/src/public/shared/mana-symbols.js"   // codegen from an API
#    Identify them mechanically, not by eye:
grep -rln 'vendored\|@generated\|DO NOT EDIT\|AUTO-GENERATED' src/ | head
awk 'length($0)>2000 {print FILENAME; nextfile}' $(git ls-files '*.js')   # minified

# 4. Then reformat, and re-check every gate -- not just the linter.
pnpm run lint:fix && pnpm run check:linecap && pnpm run build:all && pnpm run test:all
```

## NOTES

- Decide *deliberately* whether you want the reformat at all. "The config says tabs" is a weak reason to rewrite 948 files; the alternative (fix only real rule findings, leave formatting alone) keeps the diff reviewable and blame intact.
- If you do land it, land it as its own commit with nothing else in it, so the next person can `git log --ignore-rev` past it.
- Vendored/generated files belong in `files.includes` as negated globs, not suppressed inline -- an inline `biome-ignore` in a generated file disappears on the next regeneration.
- Check the file's own header before "fixing" it. `shared/idb.js` opened with `// vendored from the "idb" npm package (v8.0.3), unmodified build output` -- editing it would have silently forked a dependency.
- A formatter-only change is behavior-preserving in the language sense, so build/typecheck/tests stay green and give false reassurance. The gate that catches it is whichever one measures *shape* (line counts, file size, bundle size).
- Related: the typescript entry on excluded directories -- another case of a green gate that was never looking at the thing you changed.
