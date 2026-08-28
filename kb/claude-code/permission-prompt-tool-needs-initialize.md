---
tech: claude-code
tags: [cli, sdk, headless, permissions, approvals, control-protocol, subprocess, stream-json, contract-test]
severity: high
---
# `--permission-prompt-tool` alone never makes the CLI ask, and the flag is hidden from `--help`

## PROBLEM

Driving `claude -p --input-format stream-json` as a subprocess and want a human to
approve tool use? The documented-looking lever is `--permission-prompt-tool`. Passing it
does nothing on its own.

The stdio permission surface needs **two** things, and neither works without the other:

1. `--permission-prompt-tool stdio` in argv, and
2. the SDK's `initialize` **control_request** written to stdin.

Verified as a 2x2 against **claude 2.1.248**, on a prompt that genuinely needs approval:

| `--permission-prompt-tool stdio` | `initialize` sent | CLI asks? |
|---|---|---|
| no  | no  | no -- "this session is non-interactive so I can't get it granted" |
| no  | yes | no -- the CLI does not even ANSWER the initialize |
| yes | no  | no -- same non-interactive refusal |
| **yes** | **yes** | **YES** -- `can_use_tool` control_request arrives |

Four things make this expensive to discover:

- **The flag is hidden from `--help`.** You cannot find it by reading, and you cannot
  tell "unknown option" from "recognised" by guessing. Probe it with a *missing
  argument*: a recognised flag answers `option '--permission-prompt-tool <tool>'
  argument missing`, an unrecognised one answers `unknown option`.
- **`stdio` is a sentinel, not an MCP tool name.** Pass a real MCP tool name and you
  select a different surface entirely -- the CLI answers `must be an MCP tool` or
  `not found. Available MCP tools: none`.
- **A benign probe "proves" the flag does nothing.** The CLI's auto-mode classifier
  waves obviously-harmless commands through without asking anyone. `echo harbormaster`
  never produced a card under **any** permission mode, with the flag present and the
  handshake done. Probe with something nothing auto-approves -- `curl`, `rm -rf`.
- **Nothing fails.** Without the handshake the run completes successfully and reports
  in prose that the command "was blocked -- this session is non-interactive". The
  operator's approval UI simply never fires, and every unit test against a fixture that
  emits `can_use_tool` unprompted keeps passing. One codebase shipped a fully wired
  approval path -- SSE, amber card, POST /decide, adapter round-trip -- for two
  increments, in which it could not fire once.

## WRONG

```js
// Spawns fine. Runs fine. NEVER asks. The Allow/Deny UI downstream is unreachable,
// and no test that stubs the CLI can tell you so.
const child = spawn("claude", [
  "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
  "--permission-prompt-tool", "stdio",
  "--permission-mode", "acceptEdits",
  "--session-id", sessionId,
])
child.stdin.write(JSON.stringify({
  type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] },
}) + "\n")
```

## RIGHT

```js
const child = spawn("claude", [
  "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
  "--permission-prompt-tool", "stdio",   // half of it
  "--permission-mode", "acceptEdits",
  "--session-id", sessionId,
])

// The other half. Writing both frames back to back is enough -- there is no need to
// await the ack. `hooks: {}` is the minimal payload the CLI accepts.
child.stdin.write(JSON.stringify({
  type: "control_request",
  request_id: randomUUID(),
  request: { subtype: "initialize", hooks: {} },
}) + "\n")

child.stdin.write(JSON.stringify({
  type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] },
}) + "\n")

// Now a can_use_tool control_request arrives for anything the classifier will not
// auto-approve. Answer it on stdin, echoing request_id verbatim:
//
//   { type: "control_response",
//     response: { subtype: "success", request_id: <echoed>,
//                 response: { behavior: "allow" } } }
//
// On DENY, `message` is REQUIRED -- a deny without one is silently dropped and the run
// hangs forever. `updatedInput` is optional on allow: never send it, or you silently
// rewrite arguments the operator was shown and approved.
```

## NOTES

- **`--permission-mode` choices are `acceptEdits, auto, bypassPermissions, manual,
  dontAsk, plan`.** `default` is *accepted but undeclared* -- it runs, and an invalid
  value is rejected naming only the six. Relying on it is version-fragile. Internally
  `manual` aliases to `default`. Both `acceptEdits` and `default` ask once the two
  preconditions hold; `bypassPermissions` does not, which is the point of it.

- **The CLI does not exit after `result` while stdin is open.** It waits for the next
  turn -- which is what makes a driven session steerable. A scripted test fixture
  typically calls `process.exit(0)`, so `for await (const e of events) {}` terminates
  against the fake and **hangs forever** against the vendor. Break on your terminal
  event and kill the child; do not drain to stream end.

- **Strip `CLAUDE_CODE_*` from the child's environment when probing.** An interactive
  Claude Code session exports `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION` and others;
  inheriting them makes the child behave as a nested session and produced misleading
  results in the first round of this investigation. Spawn with `PATH`/`HOME`/`USER`
  only.

- **Breaking out of `for await` closes an async generator.** A test that stops at the
  permission card and then re-iterates the same handle to answer it gets an already-
  closed stream. Drive one iterator by hand with `.next()`.

- **The general lesson, worth more than the flag:** a wired path never contract-tested
  against the vendor is not a shipped path. A fixture proves your *translation*; only a
  contract test against the real binary proves the *conversation*. Gate it behind an env
  var, run it on every CLI upgrade, and have it print which modes actually asked.

- Related: [hook-matcher-tool-names-only](hook-matcher-tool-names-only.md) and
  [hook-env-vars-do-not-exist](hook-env-vars-do-not-exist.md) -- the same shape of bug
  one layer up, where a correctly-wired thing silently never fires.
