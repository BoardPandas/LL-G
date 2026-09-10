---
tech: bash
tags: [case, pattern-matching, alternation, glob, variable-expansion, hooks, silent-failure, extglob]
severity: high
---
# A `|` alternation stored in a variable is a literal pipe to `case`, and the pattern matches nothing

## PROBLEM

`case` resolves the `|` that separates its alternatives when the statement is
**parsed**, before any expansion happens. A variable is expanded afterwards, so
its `|` never becomes a separator -- the expansion is one pattern containing a
literal pipe character.

```bash
p="up|redeploy"
case "up"          in $p) echo hit ;; esac   # prints nothing
case "up|redeploy" in $p) echo hit ;; esac   # prints hit
```

So the pattern is not "broken": it matches exactly one string, the one nobody
passes. `[[ "$tok" == $p ]]` fails identically, which removes the obvious escape
hatch.

Everything about the code reads correct. The literal form beside it works, so a
refactor that lifts `up|redeploy` out of the `case` into a parameter looks like
a pure extraction. There is no error, no warning, no non-zero exit -- the branch
is simply never taken, and `set -u`/`set -e`/ShellCheck all stay quiet.

The damage depends on which way the function fails open. In a PreToolUse deploy
gate (vigilis `.claude/scripts/require-release-authorization.sh`), the helper
was `invokes_subcommand 'railway' 'up|redeploy'`; the tool token matched (a
single word, no pipe) and the subcommand never did, so `is_production_deploy`
returned false for **every** command and the blocking gate stopped firing
entirely. It exits 0 with no output -- indistinguishable from "correctly decided
this is not a deploy". A gate that has quietly stopped gating is the worst
outcome the hook has, and it was introduced by the commit that was fixing the
opposite bug (the gate being too eager).

Nothing catches this except a test asserting the direction that must still
BLOCK. A one-way test -- "the false positives are gone" -- passes with maximum
enthusiasm on a gate that now allows everything.

## WRONG

```bash
# Pattern lists passed as parameters. The tool matches, the subcommand never does.
invokes_subcommand() {
  local tool_pat="$1" sub_pat="$2"
  local tok seen=0
  for tok in $SCAN; do
    if [ "$seen" = 0 ]; then
      case "$tok" in $tool_pat) seen=1 ;; esac   # 'railway' -- one word, works by luck
      continue
    fi
    case "$tok" in
      $sub_pat) return 0 ;;                      # 'up|redeploy' -- matches NOTHING
    esac
  done
  return 1
}

invokes_subcommand 'railway'    'up|redeploy' && return 0   # never true
invokes_subcommand 'fly|flyctl' 'deploy'      && return 0   # tool never matches either
```

`[[ ]]` is not a fix -- it has the same parse-time/expansion-time split:

```bash
p="up|redeploy"
[[ "up" == $p ]] && echo hit    # prints nothing
```

## RIGHT

```bash
# Space-separated lists, compared with `=`. No pattern semantics, so nothing to
# get wrong -- and word splitting needs `set -f` so a token like `*` cannot
# glob-expand against the working directory.
invokes_subcommand() {
  local tools="$1" subs="$2"
  local tok cand seen=0 result=1 restore_glob=0

  case $- in
    *f*) ;;
    *)   restore_glob=1; set -f ;;
  esac

  for tok in $SCAN; do
    if [ "$tok" = ";" ]; then seen=0; continue; fi
    if [ "$seen" = 0 ]; then
      for cand in $tools; do
        if [ "$tok" = "$cand" ]; then seen=1; break; fi
      done
      continue
    fi
    for cand in $subs; do
      if [ "$tok" = "$cand" ]; then result=0; break 2; fi
    done
  done

  [ "$restore_glob" = 1 ] && set +f
  return "$result"
}

invokes_subcommand 'railway'    'up redeploy'
invokes_subcommand 'fly flyctl' 'deploy'
```

If you genuinely need glob alternation from a variable, `extglob` does survive
expansion -- but it is bash-only, needs `shopt -s extglob` in scope at match
time, and silently degrades to a literal string when it is not:

```bash
shopt -s extglob
p='@(up|redeploy)'
case "up" in $p) echo hit ;; esac    # prints hit
```

Prefer the exact-match loop. It works in every POSIX shell, needs no shopt, and
cannot fail silently.

## NOTES

- Verified on GNU bash 5.3.9. This is specified behaviour, not a bug: POSIX has
  `case` alternatives as grammar, so no shell will ever alternate a variable's
  `|`. Do not expect a newer bash to change it.
- Single-word patterns in a variable DO work (`tool_pat='railway'`), which is
  what makes the bug so easy to ship: the multi-word list beside it looks like
  the same construct and is the only one that is dead.
- The glob characters `*`, `?` and `[...]` from a variable DO work as patterns.
  Only the top-level `|` separator is parse-time. So `$p` where `p='--prod=*'`
  matches fine, and a mixed list like `'--prod|--prod=*'` matches neither.
- Related: the argv-walk that this helper implements, and why a regex cannot do
  the job, is `kb/claude-code/hook-git-commit-filter-needs-argv-walk.md`. A
  blocking hook that stops firing silently is the same class as
  `kb/claude-code/hook-env-assignment-not-inherited.md`.
- **Test both directions.** This was caught only because the regression suite
  pinned the commands that must still be BLOCKED alongside the ones that must
  now be ALLOWED. Then prove the test can fail: mutate the match list each way
  and confirm the corresponding half goes red. A gate's test suite that only
  asserts "no false positives" is green on a gate that has been disabled.
