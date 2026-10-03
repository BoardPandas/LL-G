---
tech: claude-code
tags: [hooks, settings-json, cwd, claude-project-dir, silent-skip, non-blocking-error, worktree]
severity: high
---
# A hook script called by a cwd-relative path stops running after any cd

## PROBLEM
A command hook runs in the session's CURRENT directory, and that directory follows
every `cd` the agent made in an earlier Bash call, because the Bash tool's working
directory persists between calls. So `"command": "bash .claude/scripts/gate.sh"`
resolves only while the session happens to sit at the repo root. The moment the
agent works inside `dashboard/`, `desktop_agent_v2/` or a worktree path, every hook
fails with `bash: .claude/scripts/gate.sh: No such file or directory` (exit 127).

Exit 127 is a NON-blocking error. The tool call proceeds exactly as if the gate had
allowed it, and the only trace is a dim hook-error line in the transcript. The gate
is not wrong; it is absent. And it is absent per call: the same session alternates
between gated and ungated as the agent moves between directories, so the failure
looks intermittent and survives review.

Measured from 837 sessions between 2026-07-30 and 2026-10-03, in repos set up from
claude-code-bootstrap: about 6,700 hook runs failed this way. The release
authorization gate did not run on 684 shell commands, the changelog gate on 909,
and the migration recorder on 677. Nearly all of the failures came from sessions
whose shell was in a subfolder.

This is the companion of `hook-cwd-is-not-the-commit-target-repo.md`. That entry
is about one command's own `cd X && ...` not moving the hook. This one is about the
shell's persistent cwd from earlier calls moving it. Together: the hook's cwd is
guaranteed to be neither the repo root nor the command's target.

## WRONG
```json
{
  "matcher": "Bash",
  "hooks": [
    { "type": "command", "command": "bash .claude/scripts/require-release-authorization.sh" },
    { "type": "command", "command": "HOOK_PROBE_LOG=.claude/agent-memory-local/probe.log bash .claude/scripts/run-on-git-commit.sh .claude/scripts/check-prompt-md-stale.sh" }
  ]
}
```

## RIGHT
```json
{
  "matcher": "Bash",
  "hooks": [
    { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR\"/.claude/scripts/require-release-authorization.sh" },
    { "type": "command", "command": "HOOK_PROBE_LOG=\"$CLAUDE_PROJECT_DIR\"/.claude/agent-memory-local/probe.log bash \"$CLAUDE_PROJECT_DIR\"/.claude/scripts/run-on-git-commit.sh \"$CLAUDE_PROJECT_DIR\"/.claude/scripts/check-prompt-md-stale.sh" }
  ]
}
```

## NOTES
- Anchor EVERY path in the command: the script, its arguments, and env assignments
  such as a log path. Anchoring only the script leaves its relative arguments broken
  in the same way.
- Inside the scripts, source helpers relative to the script itself:
  `. "$(dirname "${BASH_SOURCE[0]}")/_helper.sh"`. Those already work from any cwd.
- Codex does not set `$CLAUDE_PROJECT_DIR`. A generated Codex mirror should use
  `"$(git rev-parse --show-toplevel)"` instead.
- Verify from a subdirectory, not the root, where both forms pass:
  `cd sub && printf '%s\n' "$payload" | CLAUDE_PROJECT_DIR=$repo bash -c "$cmd"`.
- Enforced in claude-code-bootstrap 0.20.4: wiring guard check 3d fails any hook
  that calls a `.claude/` or `scripts/` path without the `$CLAUDE_PROJECT_DIR`
  anchor, and eval case `hook-script-project-dir` covers writing a new hook.
