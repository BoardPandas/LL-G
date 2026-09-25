---
tech: doppler
tags: [cli, service-tokens, json]
severity: low
---
# doppler configs tokens --json prints null for a config with no tokens

## PROBLEM
`doppler configs tokens --json` returns `null`, not `[]`, when the config has no service tokens. Code that iterates the result crashes on exactly the empty case, which is the usual state before the first token is created.

## WRONG
```bash
doppler configs tokens -p plex -c prd --json | python3 -c "import json,sys; print([t['name'] for t in json.load(sys.stdin)])"
```

## RIGHT
```bash
doppler configs tokens -p plex -c prd --json | python3 -c "import json,sys; print([t['name'] for t in (json.load(sys.stdin) or [])])"
```
