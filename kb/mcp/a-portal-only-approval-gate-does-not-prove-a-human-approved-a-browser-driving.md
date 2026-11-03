---
tech: mcp
tags: [approvals, human-in-the-loop, step-up, passkey, browser-agent, computer-use, self-approval]
severity: high
---
# A portal-only approval gate does not prove a human approved: a browser-driving agent in the requester's signed-in browser can click Approve

## PROBLEM
Moving approval out of the MCP channel and into a web portal does not stop the AI approving its own request, because a browser-driving agent (a browser extension agent or computer use) running in the requester's own signed-in browser can open the approval URL and click Approve with the requester's session cookie.
This is the natural follow-up to "elicitation cannot be the approval gate": designers rightly move approval to a portal page and assume a session cookie means a human. The tool result even hands the agent the approval URL. Audience-separating MCP tokens from portal cookies does not help, since the agent never uses the MCP token on the portal; it uses the browser.

## WRONG
```ts
// Approval route trusts any valid portal session, including the requester's own.
router.post('/approvals/:id/decisions', requireSession, async (req, res) => {
  const a = await approvals.get(req.params.id, req.session.mspId);
  if (!isApprover(req.session.user, a.clientId)) return res.sendStatus(403);
  await approvals.decide(a.id, req.session.user.id, req.body.decision); // agent can drive this
  res.sendStatus(204);
});
```

## RIGHT
```ts
// Each approval needs a fresh step-up that requires physical presence:
// a passkey assertion with user verification, or a TOTP code from a separate device.
router.post('/approvals/:id/decisions', requireSession, async (req, res) => {
  const a = await approvals.get(req.params.id, req.session.mspId);
  if (!a) return res.sendStatus(404);
  if (!isApprover(req.session.user, a.clientId)) return res.sendStatus(403);
  if (a.requesterId === req.session.user.id && a.needsSecondPerson) return res.sendStatus(403);
  if (req.body.fingerprint !== a.fingerprint) return res.status(409).json({ code: 'changed' });
  if (a.needsStepUp && !(await stepUp.verify(req.session.user.id, req.body.step_up, `approve:${a.id}`)))
    return res.status(401).json({ code: 'step_up_required' });
  await approvals.decide(a.id, req.session.user.id, req.body.decision, { stepUp: req.body.step_up.method });
  res.sendStatus(204);
});
```

## NOTES
- Bind the step-up to the purpose and the approval id, and keep it short-lived (minutes), so one step-up cannot be replayed across approvals.
- A typed confirmation (hostname, company name) is not a mitigation on its own: the agent can type it.
- A second approver who is not the requester closes the gap without step-up, as long as that person's browser is not agent-driven too.
- If step-up is optional in a looser mode, record that as accepted residual risk rather than claiming "the AI cannot approve its own request".
- Related: mcp/mcp-elicitation-cannot-be-the-approval-gate-for-a-dangerous-tool-because-nothing.
