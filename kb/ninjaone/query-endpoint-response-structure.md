---
tech: ninjaone
tags: [api, query, response, parsing, mcp]
severity: high
---
# Query endpoint responses are wrapped in {results: [...]} -- not a plain array

## PROBLEM
NinjaOne MCP query tools (`ninjaone_query_computer_systems`, `ninjaone_query_volumes`, etc.) return their data wrapped in a `{"results": [...]}` object. If you iterate directly over the parsed JSON without unwrapping, you get strings or unexpected types instead of device objects, causing `AttributeError: 'str' object has no attribute 'get'`.

## WRONG
```python
data = json.loads(response)
# data is {"results": [...]}, not a list
for item in data:          # iterates over dict keys ("results"), yielding strings
    role = item.get('domainRole')  # AttributeError: 'str' object has no attribute 'get'
```

## RIGHT
```python
data = json.loads(response)
items = data['results']    # unwrap the results array first
for item in items:
    role = item.get('domainRole', '')
```

## NOTES
- This applies to all `ninjaone_query_*` MCP tools: `query_computer_systems`, `query_volumes`, `query_disks`, `query_os_patches`, etc.
- The `list_devices` tool returns a plain array (no wrapper), so the two endpoint families have inconsistent response shapes.
- `list_devices` returns summary fields only (id, systemName, orgId, nodeClass). It does NOT include `domainRole`, `domain`, or other system detail fields. Use `query_computer_systems` or `get_device` for those.
- When processing MCP tool output saved to a file, remember the outer wrapper is `[{type: "text", text: "<json>"}]`, so the full unwrap chain is: `json.loads(file) -> [0]['text'] -> json.loads() -> ['results']`.
