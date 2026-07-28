---
tech: typescript
tags: [lint, testing, vitest, regex, static-analysis, false-negative, code-generation, biome]
severity: high
---
# A source-scanning lint must assert its own coverage, or "no findings" means nothing

## PROBLEM

A custom lint that finds violations by scanning source text has two failure modes, and they are indistinguishable from the outside:

1. it looked at everything and found nothing (the result you want), and
2. it only looked at part of the code and found nothing there.

Both print green.

Concretely: a Vitest lint was written to enforce that every MCP tool passes an identity argument to an internal `loopback(method, path, user, body)` helper -- a real bug had shipped where `null` was passed and a tool 404'd for every caller. The first version matched call sites with a line-oriented regex. It found **73 of 242** call sites, because the formatter (Biome) wraps most multi-argument calls across several lines and a `.` in a regex does not cross a newline. The lint passed while ignoring 70% of the codebase, and would have gone on passing forever.

Nothing about the failure is visible: there is no error, the test count is unchanged, and coverage tooling reports the lint file itself as fully covered -- because the lint *ran*, it just did not *see* anything.

The same trap applies to any homegrown scanner: `grep`-based CI checks, codemod dry-runs, "count the TODOs" gates, dependency-usage audits.

## WRONG

```ts
// Line-oriented regex: silently misses every call the formatter wrapped.
const CALL = /\bloopback\(\s*"[A-Z]+",\s*([^,]+),\s*(null|[\w.]+)/g;

function findViolations(src: string) {
  const out = [];
  let m: RegExpExecArray | null;
  while ((m = CALL.exec(src))) {
    if (m[2] === "null" && !isPublicPath(m[1])) out.push(m[1]);
  }
  return out; // [] can mean "clean" OR "matched almost nothing"
}

it("passes a user to every non-public route", () => {
  expect(files.flatMap((f) => findViolations(read(f)))).toEqual([]);
});
```

## RIGHT

```ts
// 1. Parse structurally: balance parens and skip over strings/templates so
//    argument splitting survives formatting.
function splitArgs(src: string, openParen: number): string[] | null {
  const args: string[] = [];
  let cur = "", depth = 0, i = openParen + 1;
  while (i < src.length) {
    const ch = src[i] ?? "";
    if (ch === '"' || ch === "'") { const s = readQuoted(src, i, ch); cur += s.text; i = s.next; continue; }
    if (ch === "`")               { const s = readTemplate(src, i);   cur += s.text; i = s.next; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
    else if (ch === ")") { if (depth === 0) { args.push(cur.trim()); return args; } depth--; }
    else if (ch === "," && depth === 0) { args.push(cur.trim()); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  return null;
}

// 2. THE LOAD-BEARING TEST: cross-check the structured parse against a dumb
//    textual count of the same token. They must agree EXACTLY, so a formatting
//    change that defeats the parser fails loudly instead of shrinking coverage.
it("scanner sees every call site (guards against a lint that goes blind)", () => {
  let textual = 0;
  for (const file of sourceFiles()) {
    textual += (read(file).match(/\bloopback\s*\(/g) ?? []).length;
  }
  expect(textual).toBeGreaterThan(200);   // tripwire: the corpus did not vanish
  expect(parsedCalls.length).toBe(textual);
});
```

## NOTES

- **The coverage assertion is the entry, not the parser.** A better regex would have raised 73 to maybe 200; only the count cross-check makes the blind spot *impossible to keep*.
- Include a lower-bound assertion (`toBeGreaterThan(200)`) as well as the equality. Equality alone still passes if both counts collapse to 0 -- e.g. the glob stops matching after a directory rename.
- Prove the lint fails before trusting it: reintroduce the original bug, watch it go red, then revert. A lint that has never failed is an untested function.
- Prefer a real linter rule (Biome/ESLint, which parse to an AST) when the rule can be expressed there. Hand-rolled scanning is for cross-file/architectural invariants the rule engines cannot see -- here, "which HTTP path does this argument reach".
- Related: `tsconfig-exclude-voids-green-gates.md` -- the same class of false-green, where the gate never included the files at all.
