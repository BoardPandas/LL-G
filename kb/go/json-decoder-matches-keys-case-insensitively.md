---
tech: go
tags: [encoding/json, struct-tags, case-insensitive, relay, framing, protocol, security, type-field, duplicate-keys]
severity: high
---
# encoding/json matches object keys case-insensitively, so a check on the exact key misses what Go will decode

## PROBLEM
`encoding/json` decodes an object key into a struct field whether the spelling matches exactly or only ignores case. A message can therefore carry a discriminator such as `"type"` under several spellings, and the decoder will read any of them into the same field. A gate that filters on the exact string `type` sees a different value (or none) and lets the frame through, while the Go side acts on the variant it decoded.

The result is silent. JavaScript's `JSON.parse` treats `type` and `Type` as different keys, so the relay's exact-key check passes the frame, and a relay that re-serializes the object keeps the odd key untouched. The receiving Go struct then routes it as the type the attacker named. When one object carries two spellings, the later key wins, so the decoded value is whatever the sender placed last.

Seen in a relay that forwarded frames between two peers and let only the exact `type` key reach its control logic: a peer could smuggle a message type the other side treated as privileged, and the Go client honoured it.

## WRONG
```javascript
// Relay: only the exact key is checked.
const msg = JSON.parse(text);
if (String(msg.type ?? '').startsWith('control.')) return; // dropped
relay(text); // {"TYPE":"control.reset"} sails through
```

```go
type frame struct {
	Type string `json:"type"`
}

var f frame
_ = json.Unmarshal(raw, &f)
// raw = {"Type":"control.reset"} -> f.Type == "control.reset"
// raw = {"type":"offer","Type":"control.reset"} -> f.Type == "control.reset" (last key wins)
```

## RIGHT
Reject any top-level key that the decoder would fold into a field name but that is not spelled exactly. Do this on every hop that reads the discriminator, before the exact-key check.

```go
// Reject frames where a key is a case variant of a known field, or repeats one.
func hasAmbiguousKeys(raw []byte, fields map[string]bool) (bool, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	tok, err := dec.Token()
	if err != nil || tok != json.Delim('{') {
		return true, err
	}
	seen := map[string]bool{}
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return true, err
		}
		key := tok.(string)
		if seen[key] {
			return true, nil // exact duplicate
		}
		seen[key] = true
		if !fields[key] && fields[strings.ToLower(key)] {
			return true, nil // case variant of a real field
		}
		var skipped json.RawMessage
		if err := dec.Decode(&skipped); err != nil {
			return true, err
		}
	}
	return false, nil
}
```

Apply the same rule in JavaScript on the relay, so both sides agree: the check that decides what a frame means must use the same key set the decoder will use. Add a test with `TYPE`, `Type` and a duplicate `type` in both orders, and assert the frame is dropped, not only that a genuine frame still arrives.

## NOTES
- Go's documented behaviour is "prefer an exact match, else accept a case-insensitive one". The variant can be the only key present, so the preference does not help.
- Duplicate keys are not an error in `encoding/json`; the last value wins. JavaScript's `JSON.parse` also keeps the last value, so an exact duplicate gets past both sides.
- `json.RawMessage` fields and `map[string]any` decoding do not fold case. Only struct fields do, so the gap appears where a struct routes a message.
- Ask whether the field is a discriminator at all. If the frame names the message kind, a gate on the exact key is only as strong as the decoder's view of it.
