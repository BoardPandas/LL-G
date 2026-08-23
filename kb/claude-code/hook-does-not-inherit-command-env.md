---
tech: claude-code
tags: [hooks, environment, pretooluse, escape-hatch, bash, silent-failure, git]
severity: high
---
# A hook never inherits env set on the command it is judging, so a `VAR=1 cmd` opt-out is unreachable

## PROBLEM

A blocking hook is written with an escape hatch: `SKIP_CHANGELOG=1 git commit -m x`,
`SKIP_LINT=1 npm run build`, `FORCE=1 terraform apply`. The hook reads it the obvious
way, from its own environment, and the block message tells the user to reach for it.

It does nothing. The harness spawns the hook as its own process before running the
command; the assignment on the Bash tool's command line belongs to the shell that
command will run in, which does not exist yet and is never the hook's parent. The
hook sees an unset variable no matter what the user types.

Every symptom points the wrong way. The hook is wired, fires, exits 2, and prints its
reason -- it looks entirely healthy. The user follows the instructions the refusal
itself gave them, gets refused again identically, and concludes the gate is broken
rather than the bypass. There is no error, no warning, and no way to tell "the opt-out
was not requested" from "the opt-out was requested and ignored". The usual next move
is to delete the hook from settings.json, which takes the check with it.

This is the same shape as `$TOOL_NAME`/`$TOOL_INPUT` not existing
([hook-env-vars-do-not-exist](hook-env-vars-do-not-exist.md)) -- a hook reaching into
its environment for something that only ever arrives on stdin -- but it fails in the
opposite direction: there the gate silently allows everything, here it silently
refuses everything, including the documented way out.

Note that `export VAR=1` in an EARLIER Bash tool call does not reach the hook either,
and for a second reason: each Bash invocation is its own shell.

## WRONG

```bash
# check-changelog-staged.sh -- PreToolUse, matcher "Bash"
is_exempt() {
  # ...merge commits, --amend, initial commit...

  # Advertised in the failure message below. Unreachable: the harness, not the
  # user's shell, is this process's parent.
  [ "${SKIP_CHANGELOG:-}" = "1" ] && return 0
  return 1
}

fail() {
  {
    echo "BLOCKED: CHANGELOG.md is unchanged from HEAD."
    echo "For a genuinely trivial commit, set SKIP_CHANGELOG=1 to bypass."
  } >&2
  exit 2
}
```

## RIGHT

```bash
# Read the opt-out out of the COMMAND TEXT, at a command position.
#
# Quoted regions collapse to one opaque token first, so a commit message that
# merely mentions the variable does not exempt anything:
#   SKIP_CHANGELOG=1 git commit -m x         -> exempt
#   export SKIP_CHANGELOG=1 && git commit    -> exempt
#   git commit -m "SKIP_CHANGELOG=1 someday" -> NOT exempt
normalize_command() {
  printf '%s' "$HOOK_COMMAND" \
    | sed -e "s/'[^']*'/__CCQ__/g" -e 's/"[^"]*"/__CCQ__/g' \
    | tr '\n' ';' \
    | sed -e 's/[;&|()][;&|()]*/ ; /g'
}

command_sets_skip() {
  local tok state=cmd result=1
  set -f                                   # a bare `*` token must not glob
  for tok in $(normalize_command); do
    if [ "$tok" = ";" ]; then state=cmd; continue; fi
    case "$state" in
      cmd|env)
        case "$tok" in
          SKIP_CHANGELOG=1) result=0; break ;;
          export|env)       state=env ;;
          *=*)              ;;             # another assignment prefix; still a command position
          *)                state=args ;;  # past the verb: nothing here is an opt-out
        esac ;;
    esac
  done
  set +f
  return "$result"
}

is_exempt() {
  [ "${SKIP_CHANGELOG:-}" = "1" ] || command_sets_skip   # env form still works standalone
}
```

And make the refusal name the form that actually works:

```bash
echo "     SKIP_CHANGELOG=1 git commit -m \"...\"" >&2
echo "The prefix must ride on the same command being judged -- the hook reads" >&2
echo "it out of the command text, not out of its own environment." >&2
```

## NOTES

- **Test the message and the mechanism together.** The failure mode is not "the
  bypass is broken", it is "the bypass and its documentation disagree". Pin them to
  each other: grep the block message's stderr for the bypass string, assert it shows
  the command-prefix form, and in the same test assert that form exits 0.
- **Both directions, as always for a gate.** A too-eager text match is its own bug:
  `git commit -m "document SKIP_CHANGELOG=1"` must still be refused. Collapsing
  quoted regions before the walk is what buys that, and it needs its own case.
- The same reasoning applies to anything else a hook wants from the command's
  runtime: cwd after a `cd`, a `--flag` value, a redirect target. If it exists only
  once the command runs, the hook can only get it by parsing `tool_input.command`.
  See [hook-cwd-is-not-the-commit-target-repo](hook-cwd-is-not-the-commit-target-repo.md)
  for the cwd case, which usually needs fixing in the same pass as this one.
- Walk the token stream rather than matching `^SKIP_CHANGELOG=1` -- the assignment is
  valid after `&&`, after `;`, and behind `export`/`env`, and a leading-anchor regex
  misses all three while still matching inside a heredoc.
- Related: [hook-env-vars-do-not-exist](hook-env-vars-do-not-exist.md),
  [blocking-hook-stdout-discarded](blocking-hook-stdout-discarded.md) (a bypass
  advertised on stdout is dropped entirely, which looks identical from the outside).
