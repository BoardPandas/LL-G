---
tech: claude-code
tags: [wiring-guard, regex, hooks, CLAUDE_PROJECT_DIR, vacuous-check, mutation-testing]
severity: medium
---
# A hook-script existence check that anchors on whitespace matches no $CLAUDE_PROJECT_DIR-anchored hook

## PROBLEM
A wiring guard found hook script references with `/(?:^|\s)((?:\.claude|scripts)\/...)/`
and failed when the file was missing. Once every hook became
`bash "$CLAUDE_PROJECT_DIR"/.claude/scripts/x.sh`, the character before `.claude` is `/`
(an escaped quote in the JSON source), so the regex matched nothing and "referenced hook
script exists" passed vacuously for every hook. The guard stayed green while checking
nothing; deleting a hook script would not have failed CI.

## WRONG
```js
const ref = cmd.match(/(?:^|\s)((?:\.claude|scripts)\/[\w./-]+\.(?:sh|mjs|js|py))/);
if (ref && !existsSync(join(ROOT, ref[1]))) errors.push(`missing ${ref[1]}`);
```

## RIGHT
```js
const ref = cmd.match(
  /(?:^|\s)((?:"?\$\{?CLAUDE_PROJECT_DIR\}?"?\/)?)((?:\.claude|scripts)\/[\w./-]+\.(?:sh|mjs|js|py))/,
);
if (!ref) continue;
if (!existsSync(join(ROOT, ref[2]))) errors.push(`missing ${ref[2]}`);
if (!ref[1]) errors.push(`${ref[2]} is cwd-relative; anchor it at "$CLAUDE_PROJECT_DIR"`);
```

## NOTES
- Proof is a mutation, not a read: rename a referenced script in settings.json and confirm
  the guard fails. Before the fix it did not.
- Pairs with `hook-script-cwd-relative-path.md`: the anchoring that fixed that defect is
  what blinded this check.
- General rule: a guard is only coverage once you have watched it fail.
