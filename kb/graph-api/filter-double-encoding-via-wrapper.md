---
tech: graph-api
tags: [filter, odata, url-encoding, double-encoding, mcp, sdk, BadRequest, wrapper]
severity: medium
---
# Pre-encoded %27 in $filter breaks when a wrapper encodes for you (double-encoding)

## DECISION RULE
Encode **exactly once**, at the layer that builds the URL.

| What you are doing | Who owns encoding | What to pass |
|---|---|---|
| Concatenating a URI string (`Invoke-MgGraphRequest -Uri "...?$filter=..."`, `curl`, raw REST) | **You** | `%27` and `%20` -- see [filter-encoding.md](filter-encoding.md) |
| Passing `$filter` as a parameter (SDK `-Filter`, an MCP tool's `query` object, any typed client) | **The library** | plain single quotes -- this entry |

Getting this backwards fails in both directions, with two different and equally confusing errors. This entry covers the second row.

## PROBLEM
Any wrapper that accepts `$filter` as a **structured parameter** (a Graph MCP server's `query` object, `Get-Mg* -Filter`, an SDK query builder) URL-encodes the value before sending it. If you pre-encode, the `%` itself gets escaped to `%25`, so Graph receives the literal text `%27` and rejects it:

```
Invalid filter clause: Syntax error: character '%' is not valid at position 23 in
'startswith(displayName,%27Kamolika%27)'
```

Two things make this cost real time:

1. **The error names your value, not the encoding layer.** It reads like a malformed OData expression, so you go rewrite the filter logic rather than removing the encoding.
2. **The tool's own documentation can tell you to pre-encode.** At least one Graph MCP server's `graph_request` description states "single quotes inside `$filter` must be percent-encoded as `%27`" and then rejects exactly that. Trust the observed 400 over the parameter docs.

The same shape appears with spaces: pre-encoding `%20` through a parameter interface yields a filter containing literal `%20` where a space belonged.

## WRONG
```jsonc
// Graph MCP graph_request -- $filter passed as a structured `query` parameter.
// The server encodes it for you, so pre-encoding double-encodes.
{
  "tenant": "Contoso",
  "method": "GET",
  "path": "/users",
  "query": {
    "$filter": "startswith(displayName,%27Kamolika%27)"
  }
}
// 400: Invalid filter clause: Syntax error: character '%' is not valid at position 23
```

## RIGHT
```jsonc
// Plain single quotes. The wrapper owns the encoding.
{
  "tenant": "Contoso",
  "method": "GET",
  "path": "/users",
  "query": {
    "$filter": "startswith(displayName,'Kamolika') or startswith(surname,'Das')"
  }
}
```

```powershell
# Same rule in the PowerShell SDK: -Filter is a parameter, so plain quotes
Get-MgUser -Filter "startswith(displayName,'Kamolika')"      # correct
Get-MgUser -Filter "startswith(displayName,%27Kamolika%27)"  # 400, same cause
```

## NOTES
- Quick triage by error text:
  - `character '%' is not valid at position N` -> you encoded and the layer encoded again. **Remove** your encoding.
  - `incompatible types 'Edm.String' and 'Edm.Guid'` (or a bare unquoted value) -> nobody encoded. **Add** it. See [filter-encoding.md](filter-encoding.md).
- A literal single quote *inside* a value is a separate concern and is escaped by **doubling** it in OData, at whichever layer: `displayName eq 'O''Brien'`. That is OData string escaping, not URL encoding, and it applies in both rows of the table above.
- Generalizes past `$filter` to any OData param a wrapper takes structurally (`$search`, `$expand`).
- If you cannot tell which kind of interface you have, send one plain-quote request. A wrapper-encoding layer succeeds; a raw string interface returns the type-mismatch error and tells you to encode.
