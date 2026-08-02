---
tech: claude-code
tags: [hooks, pretooluse, validation, git, pre-commit, silent-failure, ci]
severity: high
---
# A PreToolUse guard that inspects the command text is satisfied by a command that does nothing

## PROBLEM

A PreToolUse hook fires **before** the command runs. So a gate that wants to
check state the command is about to produce cannot see it — and the tempting
escape is to inspect the command *text* instead.

A pre-commit gate requiring a changelog entry hits this immediately. It wants
`git diff --cached` to contain `CHANGELOG.md`, but the agent's habitual shape is
one compound command:

```
git add CHANGELOG.md VERSION package.json && git commit -m "..."
```

At hook time nothing is staged yet, so the honest check blocks a legitimate
commit. The fix that suggests itself is to allow any command whose text mentions
staging the file:

```bash
if printf '%s' "$input" | grep -qE 'git add [^&|;]*CHANGELOG\.md'; then exit 0; fi
```

That is now a gate on **intent**, not on **state**, and intent is trivially
satisfiable without doing the thing. `git add CHANGELOG.md` stages nothing when
the file is unmodified, so the exemption fires for a commit that carries no
entry at all. Combine it with a scripted changelog edit that silently no-ops
(see NOTES) and the gate waves through exactly the commits it exists to stop —
two releases shipped with bumped versions and no changelog entries, and the gate
reported success every time.

The second half of the trap: even a state-based check can verify the wrong
thing. "CHANGELOG.md changed" is not "CHANGELOG.md documents this release". A
file can be edited and still not mention the version being shipped.

## WRONG

```bash
# Gate on what the command SAYS it will do.
input=$(cat)
if printf '%s' "$input" | grep -qE 'git add [^&|;]*CHANGELOG\.md'; then
  exit 0                      # passes even when the file is unmodified
fi
git diff --cached --name-only | grep -q '^CHANGELOG.md$' || exit 2
```

## RIGHT

```bash
input=$(cat)
printf '%s' "$input" | grep -qE 'git[[:space:]]+commit' || exit 0

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0

# Exemptions that are about the commit itself, not about the command string.
git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && exit 0
printf '%s' "$input" | grep -qE 'git[[:space:]]+commit[^&|;]*--amend' && exit 0
[ "${SKIP_CHANGELOG:-}" = "1" ] && exit 0
git rev-parse -q --verify HEAD >/dev/null 2>&1 || exit 0   # initial commit

fail() { printf '%s\n' "$@" >&2; exit 2; }   # exit 2 discards stdout

# 1. State, not intent: does the file differ from HEAD? Covers staged AND
#    already-edited-but-unstaged, so no text exemption is needed.
git diff --quiet HEAD -- CHANGELOG.md 2>/dev/null &&
  fail "BLOCKED: CHANGELOG.md is unchanged from HEAD." \
       "This hook runs BEFORE the command, so editing the changelog in the same" \
       "compound command does not count -- make the edit a separate step first."

# 2. Verify the CONSEQUENCE, not just that a file moved.
version=$(tr -d ' \t\n\r' < VERSION)
grep -qF "## [$version]" CHANGELOG.md ||
  fail "BLOCKED: CHANGELOG.md has no '## [$version]' section."
```

## NOTES

- The workflow implication is real and worth stating in the block message: with a
  state-based check, **the edit must be its own step before the commit call**. A
  PreToolUse hook can never validate a file the same command is about to write.
  Accepting that is the price of a gate that actually holds.
- Check the consequence, not the artifact. "The file changed" is weak; "the file
  names the version being shipped" is the invariant you care about, and it is the
  one that catches a scripted edit that silently failed to apply.
- Verify a blocking hook against its **refusal** path, not just that it fires.
  Build a throwaway repo and assert an exit code per case: unchanged file,
  missing section, valid case, `--amend`, merge in progress, opt-out env var, a
  non-commit command, and invocation from a subdirectory. Several of these pass
  vacuously if the hook's `cd` or self-filter is wrong.
- Testing a commit hook from an agent session is awkward, because any test
  command containing the literal `git commit` trips the live hook. Assemble the
  string (`G=git; CM=commit; "$G $CM -m x"`) so the self-filter does not match.
- Root cause of the damage this gate failed to stop:
  `kb/bash/in-place-edit-no-match-silent-noop.md`.
- Related hook failures: `kb/claude-code/hook-env-vars-do-not-exist.md` (guard on
  a nonexistent variable disables the gate),
  `kb/claude-code/blocking-hook-stdout-discarded.md` (the refusal message must go
  to stderr), and
  `kb/claude-code/hook-git-commit-filter-needs-argv-walk.md` (a regex cannot
  reliably decide whether a command is `git commit`).
