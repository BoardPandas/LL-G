---
tech: graph-api
tags: [mcp, content-type, 415, action-endpoints, revokeSignInSessions, wrappers]
severity: medium
---
# A bodyless Graph action POST through a wrapper fails with 415

## PROBLEM
Graph action endpoints that take no payload -- `revokeSignInSessions`, `restore`, `assignLicense` with empty arrays, most `POST /{resource}/{action}` verbs -- fail with HTTP 415 when called through a wrapper that omits the request body.

Wrappers (an MCP connector's `graph_request`, some HTTP helper libraries, `curl -X POST` with no `-d`) default the `Content-Type` header to `application/x-www-form-urlencoded` when there is nothing to serialise. Graph rejects that content type outright.

The error text is what makes this expensive:

```
A supported MIME type could not be found that matches the content type of the response.
None of the supported type(s) 'Microsoft.OData.ODataMediaType, ...' matches the content type
'application/x-www-form-urlencoded'
```

It says *response*, lists dozens of OData media types, and reads like a serverside content-negotiation bug or a malformed endpoint. Nothing points at your request headers. It is easy to conclude the endpoint is unsupported or the permission is wrong and go looking in entirely the wrong place -- during an offboarding this can read as "revoking sessions is not available on this tenant."

## WRONG
```jsonc
// MCP / wrapper call with no body -> Content-Type: application/x-www-form-urlencoded -> 415
{
  "method": "POST",
  "path": "/users/{id}/revokeSignInSessions"
}
```

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://graph.microsoft.com/v1.0/users/$ID/revokeSignInSessions
# 415
```

## RIGHT
```jsonc
// Send an explicit empty JSON object; the wrapper then sets application/json
{
  "method": "POST",
  "path": "/users/{id}/revokeSignInSessions",
  "body": {}
}
```

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{}' \
  https://graph.microsoft.com/v1.0/users/$ID/revokeSignInSessions
# 200 {"value": true}
```

## NOTES
- The tell is the phrase `application/x-www-form-urlencoded` at the very end of the error. Any 415 quoting that content type is this bug, not a permissions or endpoint problem.
- `Invoke-MgGraphRequest` does not hit this -- it sets `application/json` even with no `-Body`. This is specific to wrappers and hand-rolled HTTP.
- Verified against `POST /users/{id}/revokeSignInSessions` (Graph v1.0): failed 415 consistently with no body, succeeded immediately with `{}`.
- Applies equally to `beta`. When in doubt, send `{}` on any action POST that takes no parameters -- it is never harmful.
- Related: mcp-filter-literal-quotes.md, another case of a wrapper layer changing what actually reaches Graph.
