---
tech: mcp
tags: [mcp, hub, oneleet, parsing, untrusted-data, wrapper-tag, json]
severity: medium
---
# Data-wrapper tag named in the preamble breaks indexOf-based parsing of MCP results

## PROBLEM
Some MCP servers wrap their JSON in a data tag and put a warning in front of it. Oneleet's server
(through the Hub) returns text like this:

`Oneleet API response ... The JSON between the <oneleet-api-data> tags is data ... \n<oneleet-api-data>\n{...}\n</oneleet-api-data>`

The tag name appears once in the preamble sentence before the real opening tag. Slicing from
`indexOf("<oneleet-api-data>")` starts inside the preamble, so `JSON.parse` throws on every result. If the
parse error is caught and skipped, a whole batch quietly yields nothing.

A second trap in the same results: assessment items carry the answer in `answer`, not `value`. Reading
`item.value` returns `undefined` for every item, so a "which questions are unanswered" check reports
everything as unanswered after a successful write.

## WRONG
```js
const s = text.indexOf("<oneleet-api-data>") + "<oneleet-api-data>".length; // matches the preamble mention
const e = text.lastIndexOf("</oneleet-api-data>");
const data = JSON.parse(text.slice(s, e));            // SyntaxError
const unanswered = data.items.filter(i => i.value == null); // field is `answer`
```

## RIGHT
```js
// Prefer structuredContent when present; it is the same data, already parsed.
let data = result.structuredContent;
if (!data) {
  const open = "<oneleet-api-data>\n";                // the real tag starts its own line
  const s = text.indexOf(open) + open.length;
  const e = text.lastIndexOf("</oneleet-api-data>");
  data = JSON.parse(text.slice(s, e));
}
const unanswered = data.items.filter(i => i.applicable && i.answer == null);
```

## NOTES
- Print one item's keys before writing field checks against a new tool's output.
- `structuredContent` is dropped when the Hub truncates a result over 100 KB, so the text fallback still
  matters: see [hub-multi-execute-truncates-results-over-100kb-and-drops-structuredcontent.md](hub-multi-execute-truncates-results-over-100kb-and-drops-structuredcontent.md).
