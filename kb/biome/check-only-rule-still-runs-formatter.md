---
tech: biome
tags: [biome, lint, ci, exit-code, formatter, guard, misattribution, only-flag]
severity: high
---
# `biome check --only=<rule>` still runs the formatter, so a rule-scoped gate blames the wrong cause

## PROBLEM

`--only=<rule>` narrows which LINT RULES run. It does not narrow `biome check` down to
linting. `check` is lint + format + assists, and it exits non-zero if ANY of the three has
something to say. So a CI guard built around a single rule -- which is the usual reason to
reach for `--only` at all -- also fails on a formatting drift in a completely unrelated
file. If that guard maps "non-zero exit" to "my rule fired", it reports a rule that is
provably clean.

This is worse than a bare failure. The wrong cause is stated with total confidence, in the
guard's own voice, naming a rule and a file set that have nothing to do with the problem.
Whoever picks it up starts by searching for undeclared variables that do not exist.

Measured on Biome 2.5.6, and the reason exit codes are enough to tell the cases apart:

| input | `check --only=R` | `lint --only=R` | `format` |
|---|---|---|---|
| format-dirty, lint-clean file | 1 | 0 | 1 |
| undeclared variable, format-clean | 1 | 1 | 0 |

The real instance: a `package.json` rewritten as `JSON.stringify(pkg, null, "\t")` by an
ad-hoc version-bump script, against the 2-space `overrides` entry the repo pins for that
one file. The guard announced `correctness/noUndeclaredVariables reported errors` for a
pure indentation change, in a script whose own docblock is an argument about not trusting
a lint that reports the wrong thing.

Amplifier worth checking in your own workflow: if the job running the guard gates
deployment (`needs: [verify]`), a red verify SKIPS the deploy rather than failing it. Main
looks healthy, prod keeps serving the previous image, and the only clue on offer points at
a lint rule that was never involved.

## WRONG

```js
// Any non-zero exit is assumed to be THE rule this guard is named after.
const r = spawnSync("npx", ["biome", "check", `--only=${RULE}`, "."], { encoding: "utf8" });
if (r.status !== 0) {
	console.error(`${r.stdout || ""}${r.stderr || ""}`);
	fail(`${RULE} reported errors (see above).`); // <- untrue for every format drift
}
```

## RIGHT

```js
// Classify by exit code across the narrower commands. `--only` scopes the LINTER, so it
// applies to `check` and `lint` and is meaningless for `format`.
const run = (sub, paths) => {
	const only = sub === "format" ? [] : [`--only=${RULE}`];
	const r = spawnSync("npx", ["biome", sub, ...only, ...paths], { encoding: "utf8" });
	return { status: r.status ?? 1, out: `${r.stdout || ""}${r.stderr || ""}` };
};

const all = run("check", ["."]);
if (all.status !== 0) {
	console.error(all.out.trimEnd());
	if (run("lint", ["."]).status !== 0) {
		fail(`${RULE} reported errors (see above).`);
	} else if (run("format", ["."]).status !== 0) {
		fail(`FORMATTING is dirty -- ${RULE} itself is clean. Run the formatter and commit.`);
	} else {
		fail(`check failed, but ${RULE} and formatting are both clean: parse error, a config problem, or an assist.`);
	}
}
```

## NOTES

- Classify on exit codes, not on Biome's human-readable output. The pretty diagnostic
  header is `<file> <category>` for a format finding and `<file>:<line>:<col> lint/<rule>`
  for a lint one, which is regexable and will break the first time the renderer changes.
- The extra passes run only when the gate is ALREADY failing, so a green run still costs
  exactly one Biome invocation. There is no reason to trade accuracy for speed here.
- `--stdin-file-path` is not a way to probe this behavior: in stdin mode Biome writes the
  FORMATTED FILE to stdout instead of a report, so even `--reporter=json` hands you the
  file's contents rather than diagnostics. Probe with a real temp file inside a path the
  config actually covers, and delete it in the same command that creates it.
- Config-level failures land in the same bucket: an invalid or unparsable `biome.jsonc`
  makes `check` exit non-zero with a `deserialize` diagnostic and no rule involved at all.
  That is what the third branch above is for.
- Same family as `lint-must-assert-its-own-coverage` (typescript): a source-scanning gate
  has to be honest about what it actually measured. That entry covers a gate that reports
  green while reading nothing; this one covers a gate that reports red while blaming
  something it never read. Both fail by describing work they did not do.
- Related: `mass-format-breaks-line-count-gate` (biome) is the same collision from the
  other side -- a formatter run breaking a gate that has nothing to do with formatting.
