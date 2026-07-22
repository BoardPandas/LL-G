---
tech: biome
tags: [useOptionalChain, autofix, unsafe-fix, behavior-change, falsy, optional-chaining]
severity: high
---
# Biome's useOptionalChain autofix is not behavior-preserving: `a && a.b` is not `a?.b`

## PROBLEM

`biome check --write --unsafe` will rewrite `a && a.b` into `a?.b`. Those are **not equivalent expressions**:

- `a && a.b` short-circuits on any **falsy** `a` and evaluates to **`a` itself** -- `""`, `0`, `false`, `NaN`, `null`, `undefined`.
- `a?.b` short-circuits only on **nullish** `a` (`null` / `undefined`) and always evaluates to `undefined`.

So the value differs in two ways. For a falsy-but-not-nullish receiver the original returns `""`/`0`/`false` while the rewrite returns `undefined`; and even for a nullish receiver, `null` becomes `undefined`.

Whether that matters depends entirely on **how the result is consumed**:

- Read for truthiness (`if (...)`, a ternary test, `!!(...)`, `Boolean(...)`, `.filter(...)`, `|| fallback`) -- every one of those distinctions is invisible. Safe.
- Read as a **value** -- assigned, returned, interpolated into a template literal, compared with `===`, or handed to a typed parameter -- the difference is live. `${null}` renders `"null"` but `${undefined}` renders `"undefined"`; a `string | null` return type stops matching; `x === null` stops firing.

Because the rule is bundled with genuinely mechanical ones (unused imports, `useTemplate`, unused variables), the natural move is one blanket `--write --unsafe` over the repo. That silently ships value-position changes among hundreds of safe ones, in a diff far too large to eyeball.

## WRONG

```bash
# Sweeps useOptionalChain in with the mechanical rules. 114 sites rewritten,
# an unknown number of them in value position, buried in a 900-file diff.
biome check --write --unsafe .
```

```js
// What the rewrite actually changes:
const name = user && user.name;   // user = ""    -> ""         ; null -> null
const name = user?.name;          // user = ""    -> undefined  ; null -> undefined

`hello ${user && user.name}`      // null -> "hello null"
`hello ${user?.name}`             // null -> "hello undefined"
```

## RIGHT

```bash
# 1. Run the mechanical rules ONE AT A TIME so you control what lands.
for r in correctness/noUnusedImports correctness/noUnusedVariables \
         style/useTemplate complexity/useLiteralKeys; do
  biome check --write --unsafe --only="$r" .
done
# useOptionalChain deliberately NOT in that list.

# 2. Classify useOptionalChain sites by how the result is consumed, then decide.
biome check . --max-diagnostics=20000 2>&1 \
  | grep -E 'lint/complexity/useOptionalChain' | sed 's/ .*//' \
  | while IFS= read -r spec; do f=${spec%%:*}; r=${spec#*:}; l=${r%%:*}
      printf '%s|%s\n' "$spec" "$(sed -n "${l}p" "$f" | sed 's/^[[:space:]]*//')"
    done
# Condition / ternary test / !!() / Boolean() / .filter() / || fallback  -> safe
# Assignment, return, template literal, === comparison                  -> review
```

```js
// 3. Only then apply, and re-run typecheck + tests.
biome check --write --unsafe --only=complexity/useOptionalChain .
```

## NOTES

- A cheap classifier misses multi-line ternaries: `x && x.trim()` on its own line looks like a value, but the `?` is on the next line, making it a condition. Widen the window (`sed -n "$((l-2)),$((l+2))p"`) before judging, or you will over-flag.
- In practice all 114 sites in one repo turned out to be conditions or ternary tests, so the rewrite was exact -- but that was established by inspection, not assumed.
- TypeScript catches a subset for free: if the expression feeds a `string | null` annotation, the `null`->`undefined` shift is a compile error. It catches nothing in untyped JS, which is where the risk actually concentrates.
- `--only=<rule>` is the general tool here: it makes an "unsafe" pass auditable one rule at a time instead of an all-or-nothing gamble.
- Same-family rules worth the same treatment: `noUselessTernary`, `useSimplifiedLogicExpression`, and anything rewriting `||` to `??` (identical falsy-vs-nullish trap).
