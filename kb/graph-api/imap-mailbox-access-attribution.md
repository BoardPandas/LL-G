---
tech: graph-api
tags: [unified-audit-log, mailitemsaccessed, imap, signin-logs, noninteractive, appid, attribution, oauth-apps, mailbox-compromise]
severity: high
---
# IMAP MailItemsAccessed records carry no AppId -- attribute via non-interactive sign-in logs

## PROBLEM
When attributing third-party OAuth app access to a mailbox, the Unified Audit Log
`MailItemsAccessed` records for IMAP carry NO AppId. The `ClientInfoString` shows
`Client=POP3/IMAP4; Protocol=IMAP4` with an empty AppId field, so you cannot tell
WHICH registered app pulled the mail from the audit record alone. Compounding it:
the default `auditLogs/signIns` feed (v1.0 and beta) returns ONLY interactive
sign-ins, so the token-refresh / background activity of an OAuth/IMAP app is
invisible unless you explicitly ask for non-interactive events. Result: you
conclude "no app activity" when the app is in fact polling the mailbox 24/7.

## WRONG
```powershell
# Tries to read the app off the mailbox audit record -- AppId is empty for IMAP
Search-UnifiedAuditLog -Operations MailItemsAccessed -StartDate $s -EndDate $e |
  ForEach-Object { ($_.AuditData | ConvertFrom-Json).AppId }   # blank for IMAP

# And the default sign-in feed hides background app token refreshes entirely
Invoke-MgGraphRequest -Method GET `
  -Uri "https://graph.microsoft.com/v1.0/auditLogs/signIns?`$top=50"
```

## RIGHT
```powershell
# Correlate against NON-INTERACTIVE sign-ins filtered to Exchange Online.
# signInEventTypes/any(...) is REQUIRED to surface background/token-refresh logins.
$filter = "signInEventTypes/any(t:t eq 'nonInteractiveUser') " +
          "and resourceDisplayName eq 'Office 365 Exchange Online'"
Invoke-MgGraphRequest -Method GET -Uri (
  "https://graph.microsoft.com/beta/auditLogs/signIns?`$filter=" +
  [uri]::EscapeDataString($filter))
# The appId / appDisplayName on these sign-in events identifies the OAuth app
# behind the otherwise-anonymous IMAP MailItemsAccessed activity.
```

## NOTES
- Use `'servicePrincipal'` in `signInEventTypes/any(...)` to also catch pure
  app-only token activity; `nonInteractiveUser` covers delegated background tokens.
- Workflow: find the access window in MailItemsAccessed, then pivot to
  non-interactive sign-ins in the same window filtered to Exchange Online to name
  the app, IP, and consent.
- Real-world: this is how "Important Santiago" mailbox activity was traced to the
  Salesforge cold-email app polling EXO every ~30 min despite empty audit AppIds.
