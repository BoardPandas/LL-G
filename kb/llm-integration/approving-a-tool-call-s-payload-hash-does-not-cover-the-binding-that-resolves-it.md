---
tech: llm-integration
tags: [approval, payload-hash, tool-binding, human-in-the-loop, mcp, agents]
severity: high
---
# Approving a tool call's payload hash does not cover the binding that resolves it

## PROBLEM
An approval bound to a hash of `{toolName, args}` does not cover the per-agent binding that maps a generic tool name to the remote call. If that binding changes between proposal and execute, the gateway runs a different call than the reviewer approved, and the hash still matches.
Agent platforms often expose generic tool names (`directory.disable_user`, `mail.create_draft_reply`) and bind them per tenant to a remote tool plus pinned arguments (HTTP method, path template, tenant id). The model's arguments are unchanged, so the approval check passes. But the executed request comes from the binding as it is at execute time, not at approval time. The same gap lets a mapping silently change what an action means. For example, a "create draft reply" bound to a vendor tool that *sends* the reply turns an approved draft into a sent email.

## WRONG
```ts
// proposal
const payload = { toolName, args };
const payloadHash = sha256(canonicalJson(payload));

// execute: resolves the binding as it is *now*
const binding = await store.binding(agentId, payload.toolName);
if (approval.payloadHash !== payloadHash) throw new Error("mismatch");
await callRemote(binding.remoteTool, { ...payload.args, ...binding.fixedArgs });
```

## RIGHT
```ts
// tools/list returns a hash of everything that shapes the remote call
const bindingHash = sha256(canonicalJson({
  targetKind: b.targetKind, target: b.remoteTool ?? b.operationId,
  fixedArgs: b.fixedArgs, config: b.config,
}));

// proposal: the binding hash is inside the approved payload
const payload = { toolName, args, bindingHash };

// execute: refuse before claiming the action if the binding moved
const current = bindingHashOf(await store.binding(agentId, payload.toolName));
if (current !== payload.bindingHash) return fail("binding_changed"); // nothing sent
```
Also render the resolved remote call (method, path, target tenant, credentials removed) in the approval preview, so the reviewer approves what will run.

## NOTES
- Proposals made before the hash existed have no `bindingHash`. Allow them only when the binding has no pinned arguments.
- Keep a deny-list of remote tools that must never be bound (send-email, shell, delete), and check pack mappings against it in CI.
- Placeholders filled into URL path segments need their own validation: reject `/`, `?`, `#` and `..`.
