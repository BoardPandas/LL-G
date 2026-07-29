---
tech: claude-code
tags: [hooks, pretooluse, posttooluse, stdin, tool_input, tool_name, guard-clause, exit-code, security-gate, silent-failure]
severity: high
---
# `$TOOL_NAME`/`$TOOL_INPUT` do not exist, and a guard clause on them disables the entire hook

## PROBLEM

Hook input arrives as JSON on **stdin**. There is no `$TOOL_NAME` and no `$TOOL_INPUT`
environment variable, the same way there is no `$CLAUDE_FILE_PATH`
(see `hook-empty-path-formats-repo.md`). Verified by dumping the hook environment: not a
single `TOOL_*` variable is set, while stdin carries the whole payload.

```
--- env ---
CLAUDE_PROJECT_DIR=<set>  CLAUDE_CODE_SESSION_ID=<set>  CLAUDE_PID=<set>  ...
--- stdin ---
{"hook_event_name":"PreToolUse","tool_name":"Bash",
 "tool_input":{"command":"...","description":"..."},"cwd":"...", ...}
```

The `$CLAUDE_FILE_PATH` case is documented around a *loud* outcome: the empty expansion
becomes "no path filter" and the formatter rewrites the whole repo. `$TOOL_NAME` fails in
the opposite and far quieter direction, because of **where it is idiomatically used** --
the guard clause on the first line of the script:

```bash
if [ "$TOOL_NAME" != "Bash" ]; then exit 0; fi
```

`$TOOL_NAME` is empty, so this is `[ "" != "Bash" ]`, which is **true**, so the script
exits 0 immediately. Everything below it -- the entire gate -- is unreachable. There is no
error, no output, no side effect, and no partial behaviour to notice. Exit 0 is also
exactly what a correctly-functioning hook that decided to allow the call returns, so the
observable behaviour of a totally disabled gate and a working gate are *identical*.

This lands hardest on safety gates, because that guard clause is the conventional way to
open one. In one repo a `PreToolUse` hook advertised in CLAUDE.md as a "HARD GATE" that
"cannot be bypassed by prompt instructions" allowed **every** Graph API permission change,
directory-role assignment and admin-consent grant for months. Its escalation pattern list
was correct and comprehensive, and was never reached. It fired on every Bash call and
returned 0 every time.

A second defect usually rides along: `exit 1` **does not block**. For `PreToolUse` and
`PostToolUse`, `2` is the blocking exit code; any other non-zero value is a non-blocking
error. So a gate that survives the guard clause and correctly detects a violation still
lets the call through if it exits 1.

Compounding all of it: a hook that reads env vars still *runs*. Probing whether the hook
fires (`printf ... >> /tmp/hook-probe`) says yes, which reads as confirmation. Firing and
enforcing are different questions, and only the second one matters.

## WRONG

```bash
#!/bin/bash
# PreToolUse, matcher "Bash" -- privilege escalation gate

if [ "$TOOL_NAME" != "Bash" ]; then   # $TOOL_NAME is ALWAYS empty
  exit 0                              # ...so the gate ALWAYS exits here
fi

COMMAND="$TOOL_INPUT"                 # also always empty

for pattern in "${ESCALATION_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qiE "$pattern"; then
    echo "BLOCKED: privilege escalation" >&2
    exit 1                            # and 1 does not block anyway -- needs 2
  fi
done
exit 0
```

## RIGHT

```bash
#!/usr/bin/env bash
set -uo pipefail

raw=$(cat)                            # consume stdin ONCE, before anything else

# Fail CLOSED on a gate: no parser must mean "block", never "allow". Otherwise
# the fix reintroduces the original bug wearing a different hat.
if ! command -v python3 >/dev/null 2>&1 && ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: gate cannot parse its input (no python3 or jq)." >&2
  exit 2
fi

field() {  # field <dotted.path>
  printf '%s' "$raw" | python3 -c '
import sys, json
try: node = json.load(sys.stdin)
except Exception: sys.exit(0)
for k in sys.argv[1].split("."):
    if not isinstance(node, dict): sys.exit(0)
    node = node.get(k)
    if node is None: sys.exit(0)
print(node if isinstance(node, str) else json.dumps(node))
' "$1" 2>/dev/null
}

tool=$(field tool_name)
command=$(field tool_input.command)

[ "$tool" = "Bash" ] || exit 0        # now a real check, not an accidental exit
[ -n "$command" ]    || exit 0

if printf '%s' "$command" | grep -qiE 'New-MgServicePrincipalAppRoleAssignment'; then
  { echo "BLOCKED: privilege escalation detected."
    echo "Supply the permissions pass and include its verification in the script."
  } >&2                               # stdout is discarded on the blocking path
  exit 2                              # 2 blocks; 1 does not
fi
exit 0
```

## NOTES

- **Test the failure path, not the firing.** Pipe a payload that *should* be refused and
  assert the exit code: `printf '%s' "$payload" | bash hook.sh; echo $?`. A file-marker
  probe only proves the hook ran; it cannot distinguish a gate that allowed the call
  deliberately from one that exited on line 1. Both are exit 0 with no output.
- **Put those assertions in CI.** A wiring guard that validates matchers and rule scoping
  proves a hook is *reachable*, which every defect above already was. Reachability and
  enforcement are separate properties and need separate tests.
- **`hook_event_name` is in the payload too**, so one script can serve several events
  without a second copy.
- **Fail closed only where allowing is unacceptable.** A gate should block when it cannot
  parse; a formatter or advisory hook should `exit 0`, or a missing dependency turns into
  a wall of refused edits.
- Same family, different mechanisms: `hook-empty-path-formats-repo.md` (`$CLAUDE_FILE_PATH`,
  empty path means *every* file), `hook-matcher-tool-names-only.md` (the hook never fires at
  all), `hook-git-commit-filter-needs-argv-walk.md` (it fires, and the self-filter is wrong),
  `blocking-hook-stdout-discarded.md` (it blocks, and the reason is dropped). All four are
  silent, and they mask each other: fixing the matcher on a hook whose body reads env vars
  just promotes it from "never runs" to "runs and does nothing".
