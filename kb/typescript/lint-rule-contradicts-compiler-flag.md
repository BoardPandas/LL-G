---
tech: typescript
tags: [biome, eslint, lint-config, tsconfig, noUncheckedIndexedAccess, noNonNullAssertion, non-null-assertion, tech-debt]
severity: high
---
# A lint rule can directly contradict a tsconfig compiler flag, manufacturing thousands of fake findings

## PROBLEM

A linter and the TypeScript compiler are configured independently, so nothing stops them from demanding opposite things. When that happens, the linter reports a huge, alarming backlog that is not tech debt at all -- it is an artifact of the compiler setting you deliberately turned on. Treating it as debt leads to a massive, risky refactor that makes the code worse.

The canonical pair:

- `"noUncheckedIndexedAccess": true` (tsconfig) types every `arr[i]` and `map.get(k)` as `T | undefined`, forcing you to prove the value exists.
- `noNonNullAssertion` (Biome `style`, or `@typescript-eslint/no-non-null-assertion`) forbids `!`, which is the idiomatic way to do exactly that proving.

Enable both and every bounded index read is a lint finding. In one repo this produced **743 warnings**. Sampling 400 of them: **69% were literally `arr[i]!`** and **12% `map.get(k)!`** -- 81% existed purely because of the compiler flag. "Fixing" them means rewriting every indexed read into a guard, an early return, or a `.at()` check: hundreds of files touched, hot loops and test fixtures made less readable, real regression risk, and zero safety gained, because the flag already forced the author to think about it once.

The wider lesson: before starting on a large lint backlog, **sample the findings and ask whether the rule is even compatible with this project's compiler settings.** A rule can be individually reasonable and still be wrong for a codebase.

## WRONG

```jsonc
// tsconfig.json
{ "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true } }

// biome.jsonc -- recommended preset leaves noNonNullAssertion ON
{ "linter": { "rules": { "preset": "recommended" } } }
```

```ts
// The flag makes this REQUIRED...
const first = rows[0]!;              // ...and the lint rule forbids it. 743x.

// "Fixing" it inflates every bounded read, for no new safety:
const first = rows[0];
if (first === undefined) throw new Error("unreachable: rows is non-empty");
```

## RIGHT

```bash
# 1. Diagnose before you refactor -- what SHAPE are the findings?
biome check . --max-diagnostics=20000 2>&1 \
  | grep -E 'lint/style/noNonNullAssertion' | sed 's/ .*//' \
  | while IFS= read -r spec; do f=${spec%%:*}; r=${spec#*:}; l=${r%%:*}; sed -n "${l}p" "$f"; done \
  | awk '{ if ($0 ~ /\]!/) print "indexed"; else if ($0 ~ /\.get\([^)]*\)!/) print "map-get"; else print "other" }' \
  | sort | uniq -c | sort -rn
#   277 indexed      <- 69%
#    47 map-get      <- 12%   => the rule is fighting the compiler flag, not finding debt
```

```jsonc
// 2. Turn the rule off and RECORD WHY next to it.
{
  "linter": {
    "rules": {
      "preset": "recommended",
      "style": {
        // Off by design: contradicts `noUncheckedIndexedAccess: true`, set in every
        // tsconfig here. That flag types every `arr[i]` as `T | undefined`, so `!` is
        // the sanctioned way to assert an index you have already bounded -- 81% of the
        // 743 sites this flagged were exactly `arr[i]!` or `map.get(k)!`. Satisfying
        // both rules means rewriting every indexed read into a guard, which makes hot
        // loops and test fixtures worse, not safer. Prefer a short `// safe: <why>`
        // comment next to a non-obvious assertion.
        "noNonNullAssertion": "off"
      }
    }
  }
}
```

## NOTES

- Cost comparison is the deciding argument: disabling the rule was **743 findings cleared, zero code churn, zero risk**. The alternative was hundreds of files rewritten with no safety gain.
- Write the rationale in the config, not just the commit message. The next person to run `biome migrate` or refresh the preset will otherwise re-enable it.
- The same collision exists in ESLint: `@typescript-eslint/no-non-null-assertion` + `noUncheckedIndexedAccess`.
- This does **not** mean `!` is always fine. It means `!` on a *bounded index read* is the flag working as intended. A `!` on a nullable API result is still worth scrutiny -- which is why a `// safe: <why>` convention beats a blanket allow.
- Watch for the same shape elsewhere: a lint rule that forbids the escape hatch a compiler flag requires (e.g. rules banning `as` on codebases with `exactOptionalPropertyTypes`, or banning non-null on `strictNullChecks`-heavy DOM code).
- Sibling failure: a rule can also be *unfixable-by-tooling* rather than contradictory -- see the biome entry on `useOptionalChain` not being behavior-preserving.
