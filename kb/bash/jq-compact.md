---
tech: bash
tags: [jq, json, jsonl, compact, grep, wc]
severity: high
---
# jq outputs pretty-printed JSON by default -- use -c for JSONL

## PROBLEM
`jq` formats output as multi-line pretty-printed JSON by default. When building JSONL files (one JSON object per line), this breaks `grep` matching field values and `wc -l` counting entries -- both expect one JSON object per line.

## WRONG
```bash
# BAD -- outputs multi-line JSON, grep can't match fields inside it
jq -n --arg ts "$TS" '{timestamp: $ts, category: "error"}' >> log.jsonl

# Result in log.jsonl:
# {
#   "timestamp": "2026-01-01",
#   "category": "error"
# }
# grep '"category":"error"' log.jsonl  -- finds nothing (spaces around colon)
# wc -l log.jsonl  -- shows 4 lines per entry, not 1
```

## RIGHT
```bash
# GOOD -- -c flag produces compact single-line output
jq -c -n --arg ts "$TS" '{timestamp: $ts, category: "error"}' >> log.jsonl

# Result in log.jsonl:
# {"timestamp":"2026-01-01","category":"error"}
# grep '"category":"error"' log.jsonl  -- finds the line correctly
# wc -l log.jsonl  -- counts 1 per entry
```

## NOTES
- `-c` = compact (no whitespace). `-n` = null input (when not piping JSON in). These are independent flags and can be combined.
- When reading JSONL back, pipe through `jq -c '.'` to normalize any mixed-format lines before processing.
- `jq` also strips the trailing newline in compact mode -- the `>>` redirect adds one, so line endings are correct in JSONL files.
