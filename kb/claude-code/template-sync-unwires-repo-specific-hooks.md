---
tech: claude-code
tags: [hooks, settings-json, template-sync, fail-open, orphaned-scripts, wiring-guard, ci]
severity: high
---
# A shared-template sync unwires repo-specific hooks and leaves their scripts on disk

## PROBLEM

Distributing one `.claude/` template across many repos means `settings.json` gets
**replaced, not merged**. Any hook a repo added on top of the template disappears from
the config while its script stays on disk and stays tracked in git.

Nothing about that state looks wrong:

- The script is present. `ls .claude/scripts/` shows it.
- The script is tracked. `git log` shows its history.
- The diff reads as a formatting/restructuring change to one JSON file, not a deletion.
- **A hook that is never invoked fails open.** A gate that is not wired produces exactly
  the same observable behaviour as a gate that ran and allowed the call: nothing happens.

So the only signal is absence, and absence is invisible in review. A sync across 13 repos
silently unwired hooks in 6 of them, including a permissions gate the repo's own CLAUDE.md
declared "MANDATORY -- NEVER SKIP", a PowerShell script-rule gate, an auto-formatter, a DB
migration ledger recorder, and a migration-doc gate.

Two related regressions ride along in the same commit, because the template is written for
the generic case:

- Hook commands revert from `"$CLAUDE_PROJECT_DIR/.claude/scripts/x.sh"` to bare relative
  `.claude/scripts/x.sh`, which breaks whenever the session cwd is not the project root.
- Repo-local hardening (a `deny` list for destructive commands, `additionalDirectories`,
  hooks with better argv/state handling than the template's) is replaced by the template's
  weaker generic version. The template is not always newer than what it overwrites.

This is the same failure family as a dead hook matcher, one level up: there, the matcher
never matched; here, the entry is simply gone.

## WRONG

```bash
# Sync the template, eyeball the diff, ship it.
cp -r ~/templates/.claude/. ./.claude/
git add -A && git commit -m "chore: sync .claude config"

# The diff for settings.json is ~200 lines of restructured JSON.
# check-permissions-gate.sh is still in .claude/hooks/ and still tracked,
# so nothing reads as removed. It simply never runs again.
```

A grep for the script name is also a false negative on the wrong file:

```bash
# "Still referenced, we're fine" -- but this matches the script's own
# header comment and the README, not the settings.json wiring.
grep -rn "check-permissions-gate" .claude/
```

## RIGHT

```bash
# Compare the SET OF WIRED COMMANDS before vs after. Anything in the old set
# and not the new one was unwired, whatever the diff looks like.
re='"command"[[:space:]]*:[[:space:]]*"([^"]+)"'

git show HEAD:.claude/settings.json \
  | grep -oE "$re" | sed -E "s/$re/\1/" | grep -oE '[A-Za-z0-9_-]+\.sh' | sort -u > /tmp/old
grep -oE "$re" .claude/settings.json \
  | sed -E "s/$re/\1/" | grep -oE '[A-Za-z0-9_-]+\.sh' | sort -u > /tmp/new

comm -23 /tmp/old /tmp/new   # non-empty => hooks were unwired; do not commit
```

Better, make it mechanical so it fails in CI rather than in review. Assert that every
executable hook script in the repo is referenced by some config, and that every config
reference resolves to a real file:

```javascript
// scripts/check-claude-wiring.mjs -- run in CI
const CONFIGS = [".claude/settings.json", ".claude/settings.local.json", ".codex/hooks.json"];

const wired = new Set();
for (const f of CONFIGS.filter(exists)) {
  for (const block of Object.values(JSON.parse(read(f)).hooks ?? {}).flat())
    for (const h of block.hooks ?? [])
      for (const m of (h.command ?? "").matchAll(/[\w./-]+\.sh/g)) wired.add(basename(m[0]));
}

for (const script of listShellScripts(".claude")) {
  if (basename(script).startsWith("_")) continue;        // sourced helper, not a hook
  if (!wired.has(basename(script)))
    errors.push(`${script}: on disk but referenced by no config -- orphaned hook.`);
}
```

Keep an explicit allowlist for scripts that are *intentionally* retired, each with a
reason, and report an allowlist entry that no longer names an orphan as itself an error.
Otherwise the allowlist quietly grows into a way of not seeing the problem.

## NOTES

- **Verify the direction that matters.** After re-wiring, assert the gate still *refuses*
  (exit 2), not merely that it runs. See `hook-env-vars-do-not-exist.md` -- a gate can fire
  on every call and still allow everything.
- **A grep of the whole `.claude/` tree is the wrong test.** Script headers, READMEs and
  docs all mention the script name. Parse the config's `hooks` object specifically.
- **Do not assume the template is newer.** Diff the incoming hook implementations against
  the local ones before accepting them. In the observed case the template reintroduced two
  bugs the repo had already fixed and had regression tests for: it resolved no target repo
  (`hook-cwd-is-not-the-commit-target-repo.md`) and it exempted a commit on the command
  *text* mentioning `git add CHANGELOG.md` (`hook-validates-text-not-state.md`). Running
  the repo's own hook tests is what surfaced both; a repo without them ships the regression.
- **Helper files need an exemption rule, not a special case.** Sourced libraries
  (`_json-parser.sh`, `lib/hook-input.sh`) are correctly unreferenced by any matcher. A
  naming convention (leading `_`, or a `lib/` directory) keeps the orphan check honest.
- Related: `hook-matcher-tool-names-only.md`, `cursor-frontmatter-keys-ignored.md` -- both
  are the same shape, a configuration that looks active and is inert.
