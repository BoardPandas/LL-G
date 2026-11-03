---
tech: mcp
tags: [elicitation, approval, human-in-the-loop, security, url-mode, claude-code]
severity: high
---
# MCP elicitation cannot be the approval gate for a dangerous tool, because nothing proves a person saw it

## PROBLEM
A tool that returns an elicitation ("Approve running this script?") and then treats `accept` as permission lets the model, or a local hook, approve its own dangerous call.

The spec gives no proof that a human saw the prompt. Clients SHOULD, not MUST, offer approval controls. Form-mode data is visible to and controlled by the client. Claude Code documents an `Elicitation` hook that can auto-respond, and one exit code declines with no dialog shown. Support is also uneven: Claude.ai connectors are likely to lack elicitation altogether, so a gate built on it is either bypassable or unreachable depending on the client. In revision 2026-07-28 URL mode `accept` only means the user agreed to open the URL, not that anything happened there.

## WRONG
```ts
// accept is treated as the approval; the model or a hook can produce it
const r = await ctx.elicit({ mode: "form", message: `Run on ${devices}?`, schema });
if (r.action === "accept") await dispatch(script, devices);
```

## RIGHT
```ts
// Approval is a server-side record that only an authenticated portal session can create.
const fp = sha256(canonical({ script, deviceIds: [...deviceIds].sort(), tenant, requester }));
const ap = await approvals.findConsumable({ fp, tenant }); // single use, expires in 15 min
if (!ap) {
  const created = await approvals.create({ fp, tenant, requester, expiresAt: in15min() });
  // URL-mode elicitation only OPENS the portal page; never read its result as consent.
  // Clients without URL mode get the same link in the tool result text.
  return inputRequired({ mode: "url", url: `${PUBLIC_URL}/approvals/${created.id}`,
    requestState: aeadSeal({ id: created.id, sub: requester, fp, exp: created.expiresAt }) });
}
await approvals.consume(ap.id); // same transaction as dispatch
await dispatch(script, deviceIds);
```

## NOTES
- The portal page must require sign-in, check that the signed-in user is an allowed approver, and return 404 (not 403) for another tenant's approval.
- `requestState` is attacker-controlled input per the spec: seal it (AEAD), bind it to the principal, expiry and request digest, and enforce single use yourself, since the spec says those measures do not guarantee it.
- Changing the script or device list changes the fingerprint, so it needs a new approval.
- Do not use form-mode elicitation as a gate, even with a typed confirmation: the typed value comes back through the client.
- The MCP Tasks extension had no client support when this was written (2026-11-03), so long jobs should return a plain job ID.
- Related: claude-code/permissionrequest-prompt-hooks-have-no-documented-fall-through, llm-integration/approving-a-tool-call-s-payload-hash-does-not-cover-the-binding-that-resolves-it.
