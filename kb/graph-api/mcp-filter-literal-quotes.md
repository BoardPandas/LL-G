---
tech: graph-api
tags: [odata, filter, mcp, url-encoding, service-principals, applications]
severity: medium
---
# Graph MCP $filter: use literal single quotes, not %27

## PROBLEM
Microsoft Graph OData $filter string literals are delimited by single quotes. Some pre-authenticated Graph MCP tools' own docs tell you to percent-encode inner single quotes as %27. At least one such connector passes the query string through verbatim, so %27 reaches Graph un-decoded and you get HTTP 400 "Invalid filter clause: Syntax error: character '%' is not valid at position 9". Following the tool hint literally is exactly what breaks it, and the error points at the value, not the encoding.

## WRONG
```json
{ "$filter": "appId eq %27614cbcc0-d466-42a1-aa8b-bcdb2a98851b%27" }
// -> 400 BadRequest: character '%' is not valid
```

## RIGHT
```json
{ "$filter": "appId eq '614cbcc0-d466-42a1-aa8b-bcdb2a98851b'" }
// literal single quotes; the connector handles transport encoding itself
```

## NOTES
Behavior is connector-specific: if a %27 filter 400s, retry with a literal single quote before assuming the field or value is wrong. This bit on /applications and /servicePrincipals lookups by appId. Unrelated to the separate MCP rules that non-GET writes need confirm:true and privileged changes (app-role/permission changes) need a permissions pass.
