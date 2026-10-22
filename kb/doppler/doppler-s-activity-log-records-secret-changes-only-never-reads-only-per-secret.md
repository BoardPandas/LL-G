---
tech: doppler
tags: [audit, activity-log, access-logs, incident-response, breach]
severity: high
---
# Doppler's activity log records secret changes only, never reads; only per-secret Access Logs show reads

## PROBLEM
The Doppler workplace activity log (`doppler activity`, dashboard Activity) records changes only, never reads, so it cannot answer "who read this secret" during an incident.
An empty or quiet activity log after a suspected credential exposure looks like evidence nobody touched the secrets. It is not: reads by service tokens, the CLI or integrations never appear there.

## WRONG
```bash
# "No suspicious entries, so the secrets weren't read"
doppler activity --json | jq '.[] | select(.created_at > "2026-10-01")'
```

## RIGHT
```text
Dashboard -> Project -> Config -> <secret> -> Access Logs
(per-secret, Enterprise plan only) is the only record of reads.
If you lack Enterprise or did not check it, treat every secret
reachable by an exposed token as read, and rotate.
```

## NOTES
- The activity log is still useful for spotting unexpected writes, token creation and integration changes.
- Decide in incident response whether "no read evidence" means "not read" or "unknown"; for Doppler without Enterprise it is always "unknown".
