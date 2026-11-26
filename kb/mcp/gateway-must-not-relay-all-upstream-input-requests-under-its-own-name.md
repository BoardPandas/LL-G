---
tech: mcp
tags: [mcp, tasks, elicitation, gateway, proxy, input-requests, trust, sampling, roots]
severity: high
---
# A gateway must not relay every upstream input request: they reach the user under the gateway's name

## PROBLEM
A task that is waiting for input carries `inputRequests`, and each one can be any server-to-client request: a form question (`elicitation/create`, form mode), a link to open (URL-mode elicitation), a request for the client's model (`sampling/createMessage`) or for its local folders (`roots/list`). A gateway that relays them unchanged presents a third-party server's request as coming from the connector the user trusts. A link to open, or a request to use the user's model or read their folders, then looks like the gateway's own.

## WRONG
```ts
// pass whatever the upstream task is waiting for straight through
return { ...task, inputRequests: upstreamTask.inputRequests };
```

## RIGHT
```ts
function relayable(requests: Record<string, unknown>, callerDeclaresFormElicitation: boolean, source: string) {
  if (!callerDeclaresFormElicitation) return undefined;                 // the caller must say it can handle them
  const out: Record<string, unknown> = {};
  for (const [key, req] of Object.entries(requests)) {
    const params = formElicitationParams(req);                           // method === "elicitation/create", mode absent or "form", no url
    if (!params || tooLarge(params)) return undefined;                  // refuse the whole set, never part of it
    out[key] = { method: "elicitation/create", params: { ...params, message: `[${source}] ${params.message}` } };
  }
  return out;
}
// undefined -> fail the task with a plain message ("This task asked for input that is not passed on.") and cancel it upstream.
```

## NOTES
- Allow only the kinds you mean to (form questions). Link-to-open, sampling and roots requests are never relayed.
- Check the `url` key even when `mode` says form: both variants are open objects.
- Label every relayed message with the upstream's name, and bound the size of the request set.
- Declare form elicitation to an upstream only on a call whose own caller declared it; otherwise the upstream will ask for input nobody can answer.
- Forward only the input keys the upstream is still waiting for when the answer comes back.
