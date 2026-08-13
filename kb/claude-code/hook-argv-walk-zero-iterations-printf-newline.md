---
tech: claude-code
tags: [hooks, bash, pretooluse, fail-open, printf, while-read, argv-walk, blocking-hook, testing]
severity: high
---
# A hook's argv walk runs zero times when printf omits the trailing newline

## PROBLEM

`hook-git-commit-filter-needs-argv-walk.md` establishes that a regex cannot decide what a Bash
hook command actually invokes, and that the predicate is positional, so you must walk argv. That
advice is correct. Following it correctly still produced a **blocking guard that allowed
everything**, for a reason one layer below the parsing logic.

The idiomatic way to walk a command's segments is to split them onto lines and read them back:

```bash
printf '%s' "$HOOK_COMMAND" | tr ';&|' '\n' | while IFS= read -r segment; do ...; done
```

`printf '%s'` emits **no trailing newline**. `read` returns non-zero when it hits EOF without a
delimiter, and `while read` tests that return value, so the final line is never processed. When
the command is a single segment — which is the common case, `rm -rf /tmp/x` — that final line is
the *only* line, and **the loop body executes zero times**.

The function then falls through to its "nothing matched" path and the guard returns
`exit 0`. Every observable signal says the hook is healthy: it is wired in `settings.json`, the
matcher fires, the script runs, it exits cleanly, no stderr, no error. It simply never refuses
anything. This is the same fail-open shape as `hook-env-vars-do-not-exist.md` and
`template-sync-unwires-repo-specific-hooks.md`, reached by a third route.

The trap compounds with a subtlety: the pipeline runs in a subshell, so the `exit 7` used to
signal a match sets the *pipeline's* status. If you also get the newline wrong, the status is 0
for two independent reasons and neither is distinguishable from "no match found".

What makes this specifically dangerous in a hook is that the two failure directions are not
symmetric in visibility. A guard that is **too strict** announces itself immediately — it refuses
a command you wanted, you notice within seconds. A guard that is **too permissive** announces
nothing, ever. So the direction you will not notice is the direction that matters, and it is the
one a partial test suite skips: verifying the hook *allows* safe commands feels like the careful
thing to do and proves nothing about whether it still blocks.

## WRONG

```bash
# PreToolUse hook, matcher Bash, if: Bash(rm -rf*)
is_recursive_rm() {
  # printf '%s' has no trailing newline -> read hits EOF -> loop body never runs
  printf '%s' "$HOOK_COMMAND" | tr ';&|' '\n' | while IFS= read -r segment; do
    for token in $segment; do
      case "$token" in
        -*) case "$token" in *[rR]*) has_r=1 ;; esac
            case "$token" in *f*)    has_f=1 ;; esac ;;
      esac
      [ "$has_r" = 1 ] && [ "$has_f" = 1 ] && exit 7
    done
  done
  [ "$?" = 7 ]
}

is_recursive_rm || exit 0    # always taken: every rm -rf is allowed
```

An earlier single-regex version of the same guard failed in the opposite, equally silent
direction — it caught `rm -rf` and `rm -fr` but missed `rm -r -f`, because clustered and
separated flags cannot both be matched without also matching `git log --grep=rm -rf`. Neither
version was distinguishable from a working guard without an explicit test matrix.

## RIGHT

```bash
is_recursive_rm() {
  local segment token first has_r has_f
  # The trailing \n is load-bearing: without it `read` hits EOF on the final
  # (often only) segment, returns non-zero, and the loop body never executes.
  printf '%s\n' "$HOOK_COMMAND" | tr ';&|' '\n' | while IFS= read -r segment; do
    first=1; has_r=0; has_f=0
    for token in $segment; do
      if [ "$first" = 1 ]; then
        [ "$token" = "sudo" ] && continue          # step over the prefix
        [ "$token" = "rm" ] || [ "$token" = "/bin/rm" ] || break
        first=0; continue                          # `rm` as an ARGUMENT never matches
      fi
      case "$token" in
        --recursive) has_r=1 ;;
        --force)     has_f=1 ;;
        --*)         ;;
        -*) case "$token" in *[rR]*) has_r=1 ;; esac
            case "$token" in *f*)    has_f=1 ;; esac ;;
      esac
      [ "$has_r" = 1 ] && [ "$has_f" = 1 ] && exit 7
    done
  done
  [ "$?" = 7 ]
}
```

Ship the guard with a matrix that asserts **both** directions, and run it before wiring the hook
into `settings.json`:

```bash
for c in "rm -rf /tmp/x" "rm -fr build" "sudo rm -rf node_modules" "rm -r -f dist" \
         "rm --recursive --force foo" "cd x && rm -rf y" "rm -Rf dist" \
         "rm -r dist -f" "npm run build; rm -rf out"; do
  printf '{"tool_input":{"command":"%s"}}' "$c" | bash hook.sh >/dev/null 2>&1
  [ $? = 2 ] || echo "FAIL(should block): $c"
done

for c in "rm file.txt" "rm -f single.txt" "rm -r emptydir" "rm -i x" \
         "git log --grep=rm -rf" "grep -rf pattern.txt ." "echo rm -rf"; do
  printf '{"tool_input":{"command":"%s"}}' "$c" | bash hook.sh >/dev/null 2>&1
  [ $? = 0 ] || echo "FAIL(should allow): $c"
done
```

The allow cases are not padding. `git log --grep=rm -rf` and `grep -rf pattern.txt .` are the
near-misses that punish a looser regex, and they are why the first token must be checked
positionally rather than searched for anywhere in the string.

## NOTES

- **Detect the class, not the instance.** Any `printf '%s' ... | while read` is suspect, as is
  `$(cmd)` fed to `while read` when `cmd` may not end in a newline. `while read` silently drops
  an unterminated final line everywhere, not only in hooks; hooks are just where the dropped line
  is usually the entire input. `mapfile`/`readarray`, or `read` with a `|| [ -n "$segment" ]`
  continuation, avoid the shape entirely.
- **A blocking hook needs its refusal path exercised, not just its happy path.** A test that only
  checks "the hook runs and exits 0 on safe input" passes identically against a hook that has
  been dead since the day it was written. Compare `hook-env-vars-do-not-exist.md`, where an
  opening guard clause made an entire "HARD GATE" unreachable for months.
- Related, same fail-open family, different cause: `hook-env-vars-do-not-exist.md` (guard clause
  on a non-existent variable), `template-sync-unwires-repo-specific-hooks.md` (hook unwired from
  config, script still on disk), `hook-validates-text-not-state.md` (guard satisfied by a command
  that does nothing).
- Related parsing entry: `hook-git-commit-filter-needs-argv-walk.md`. This entry is the failure
  *underneath* that one — the argv walk it prescribes is correct, and can still be plumbed to
  something that never iterates.
- Remember `exit 2` blocks (not `exit 1`), and the refusal message must go to stderr or it is
  discarded — see `blocking-hook-stdout-discarded.md`. A guard can be wrong in all three ways at
  once and each one hides the others.
