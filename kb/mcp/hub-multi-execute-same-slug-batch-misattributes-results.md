---
tech: mcp
tags: [hub, multi-execute-tool, batching, attribution, writes]
severity: high
---
# Hub MULTI_EXECUTE_TOOL batches of one slug return misattributed results

## PROBLEM
When one `MULTI_EXECUTE_TOOL` request holds several calls to the **same** tool slug with different
arguments (for example `project_members_list` for 20 projects), the results array is not reliably
in request order, and each result carries only `tool_slug`, not the arguments it ran with. There is
no way to tell which result belongs to which call. A read then attributes data to the wrong item.
In a batch of three `project_members_update` writes, all three reported success but one change was
not applied. Single-item calls returned the right data every time.

## WRONG
```json
{"tools": [
  {"tool_slug": "vendor__members_list", "arguments": {"project": "alpha"}},
  {"tool_slug": "vendor__members_list", "arguments": {"project": "beta"}},
  {"tool_slug": "vendor__members_update", "arguments": {"project": "gamma", "role": "viewer"}}
]}
```
Then mapping `results[i]` to `tools[i]`.

## RIGHT
```json
{"tools": [{"tool_slug": "vendor__members_list", "arguments": {"project": "alpha"}}]}
```
One item per call; send several such calls in parallel as separate tool invocations. After any
write, re-read the item with its own single call before relying on it.

## NOTES
- Batching **different** slugs is fine when each slug appears once, because `tool_slug` identifies
  the result.
- Related: [Hub MULTI_EXECUTE_TOOL truncates results over 100 KB](hub-multi-execute-truncates-results-over-100kb-and-drops-structuredcontent.md).
