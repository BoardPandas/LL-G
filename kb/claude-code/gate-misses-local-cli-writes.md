---
tech: claude-code
tags: [hooks, pretooluse, outbound-gate, cli, shell, argv, prefilter, release-gate]
severity: high
---
# A gate that knows only API hosts and connector tool names misses a local CLI that writes

## PROBLEM
An outbound PreToolUse gate classified MCP tools by name suffix and shell commands by network host plus client (`curl`, `Invoke-RestMethod` ...). A vendor CLI installed on the machine (`sforge`, logged in with read AND write) calls the same API internally, so its command text names neither a host nor a network client. `sforge tickets reply 12 -m ...` (emails a client) and `sforge api DELETE /v1/people/tracking/...` (purges stored mail) were classified "shell command with nothing the gate guards" and ran with no release. Nothing failed; the gate looked healthy because every test it had still passed.

## WRONG
```js
// Shell rule only knows endpoints. A CLI hides the endpoint inside its own binary.
if (NET_CLIENT.test(low) && SEND_HOSTS.some((h) => low.includes(h))) found.push({ cls: "send" });
if (found.length === 0) return allow("shell command with nothing the gate guards");
```

## RIGHT
```js
// Walk argv for the CLI's program token (command position, after env assignments,
// launchers like npx, or anywhere once quotes are exposed for bash -c / node -e).
// Map each subcommand onto the connector's classes; unknown subcommands are writes.
for (const seg of shellSegments(cmd, false)) {
  const { at } = commandWord(seg);            // skips MSYS_NO_PATHCONV=1 etc.
  if (isProgram(seg[at])) found.push(...judge(seg.slice(at + 1)));
}
// judge(): tickets reply -> send; tickets update / api POST|PUT|PATCH|DELETE -> write;
// note, time log, api GET, bare path -> allow; anything else -> write.
// Read options exactly as the CLI's parseArgs does (-d consumes a value), so
// `api -d '{...}' PATCH /x` is a PATCH and a method in a variable is a write.
```
Also route every CLI name through the bash prefilter (`*sforge* | *supportforge*`), and test that the prefilter's case list covers the exported name list.

## NOTES
- Audit every installed CLI that holds credentials for a gated system (vendor CLIs, `gh`, cloud CLIs), not only network clients.
- Quoted regions are one opaque token, so `grep "sforge tickets reply"` and commit messages stay free; expose quotes only when an executor (bash -c, node, pwsh) runs them.
- Mutation-test: removing the CLI name from the prefilter must fail the suite (it failed 7 tests here).
- Related: hook-git-commit-filter-needs-argv-walk.md, case-pattern-alternation-in-variable.md (bash), release-gate-hook-matches-command-text.md.
- Fixed in BoardPandas/ExecuBot 5e72e0b (0.4.2).
