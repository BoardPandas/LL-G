---
tech: claude-code
tags: [hooks, pretooluse, git, cwd, multi-repo, silent-allow, changelog-gate]
severity: high
---
# A hook's cwd is the session's repo, not the one the command targets

## PROBLEM
A PreToolUse hook runs with the SESSION's working directory. The command it is
inspecting does not have to run there. `cd /other/repo && git commit` and
`git -C /other/repo commit` both retarget the command, and neither moves the
hook, so a gate that shells out to `git` reads a tree the command will never
touch.

This fails in both directions and only one of them is visible:

- **Loud and wrong:** the gate refuses a correct commit. The session repo is
  clean, `git diff --cached` finds nothing, and the refusal lists remediation
  steps the author already performed in the target repo. Confusing, but someone
  notices within seconds.
- **Silent and dangerous:** the gate ALLOWS a bad commit. If the session repo
  happens to have the file dirty for unrelated reasons, the check passes and the
  commit to the target repo lands with none of what the gate exists to require.
  Nothing reports this, ever.

Cross-repo work is exactly when it bites: an agent session rooted in repo A that
commits to repo B. Observed 2026-08-05 in two sibling repos whose
`check-changelog-staged.sh` resolved the repo from its own cwd -- one via
`git diff --cached`, the other via `git rev-parse --show-toplevel` followed by a
`cd`. The second form looks like it is being careful about paths, which is why it
survived longer.

## WRONG
```bash
# Both resolve the HOOK's cwd, not the command's target.
staged=$(git diff --cached --name-only)

root=$(git rev-parse --show-toplevel) && cd "$root"   # careful-looking, same bug

printf '%s' "$staged" | grep -q '^CHANGELOG\.md$' || exit 2
```

## RIGHT
```bash
# Resolve the repo the command actually targets, then scope every git call to it.
# Later occurrences win, so `cd /a && git -C /b commit` yields /b, which is what
# git itself does.
target=""
set -f; toks=($HOOK_COMMAND); set +f
n=${#toks[@]}; i=0
while [ "$i" -lt "$n" ]; do
  tok="${toks[$i]%%[;&|]*}"
  if [ "$tok" = "cd" ] && [ $((i+1)) -lt "$n" ]; then
    target="${toks[$((i+1))]%%[;&|]*}"
  elif [ "$tok" = "git" ]; then
    j=$((i+1))
    while [ "$j" -lt "$n" ]; do
      case "${toks[$j]%%[;&|]*}" in
        # read -C's value AND step past it, so `commit` is still reached
        -C) [ $((j+1)) -lt "$n" ] && target="${toks[$((j+1))]%%[;&|]*}"; j=$((j+2)) ;;
        -c|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix) j=$((j+2)) ;;
        -*) j=$((j+1)) ;;
        *)  break ;;
      esac
    done
  fi
  i=$((i+1))
done
[ -n "$target" ] && [ -d "$target" ] || target="$PWD"

git -C "$target" rev-parse --show-toplevel >/dev/null 2>&1 || exit 0
git -C "$target" diff --quiet HEAD -- CHANGELOG.md && exit 2
```

## NOTES
- Test BOTH directions or you fix only the half that was annoying you. The
  assertion that matters is "clean target, dirty cwd -> still blocks". A suite
  that checks only "dirty target, clean cwd -> allows" passes against a hook that
  still reads cwd, whenever the two trees happen to agree.
- `-C` must advance the walk by two and continue, never `break`. Break on finding
  it and `commit` is never reached, so the self-filter stops recognising the
  command and the gate silently allows everything -- the same hole as
  [[hook-git-commit-filter-needs-argv-walk]], reintroduced while fixing this one.
  Both bugs were live in the same script.
- Name the resolved repo in the block message. A refusal that says only
  "CHANGELOG.md is not staged" gives the author no way to notice it is talking
  about a different repository than the one they are committing to.
- `$CLAUDE_PROJECT_DIR` is the session root, so wiring a hook as
  `bash "$CLAUDE_PROJECT_DIR/.claude/scripts/gate.sh"` fixes which SCRIPT runs but
  not which repo it inspects. Relative wiring (`bash .claude/scripts/gate.sh`)
  additionally breaks outright once cwd moves.
- Related silent-allow in the same class of gate:
  [[hook-validates-text-not-state]]. A hook that cannot see the right repo often
  compensates by matching the command text instead.
