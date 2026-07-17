---
tech: graph-api
tags: [search, kql, mail, messages, silent-wrong-output, false-negative, filtering, forensics]
severity: high
---
# Mail $search with OR silently returns the UNFILTERED mailbox

## PROBLEM
`GET /users/{id}/messages?$search="foo" OR "bar"` does not error and does not filter. It silently returns the **default unfiltered message list** (most recent first), exactly as if `$search` had never been supplied.

This is maximally dangerous during an investigation, because the failure mode looks like a *result*. You search two mailboxes for a malicious domain, get a page of plausible-looking messages back, and conclude "found related mail". Or worse, you eyeball the subjects, see nothing matching, and conclude the opposite. Both readings are fictional -- the query never ran.

Single-term `$search` works correctly. Only the `OR` form (quoted phrases joined by `OR`) degrades.

Proof, on a real mailbox:

    $search="zzqqxnonexistentAAA" OR "zzqqxnonexistentBBB"   ->  returns 3+ real messages  (IMPOSSIBLE)
    $search="zzqqxnonexistentAAA"                            ->  returns []               (correct)
    $search="cybernodebox"                                   ->  returns []               (correct)

Two nonsense strings cannot match anything. Getting the inbox back proves the filter was dropped.

## WRONG
```powershell
# Looks like one efficient query. Actually returns the whole mailbox, unfiltered.
$q = '"cybernodebox" OR "voidwallguard" OR "nexstackrentix"'
$hits = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/users/$upn/messages?`$search=$q"
if ($hits.value.Count -gt 0) { "FOUND related mail!" }   # <-- always true, always wrong
```

## RIGHT
```powershell
# One term per request, and prove the search engine is actually filtering.
$terms = @('cybernodebox','voidwallguard','nexstackrentix')

# NEGATIVE CONTROL: a string that cannot exist must return zero.
$ctrl = Search-Mailbox $upn 'zzqqxnonexistentstringzz'
if ($ctrl.Count -ne 0) { throw 'ABORT: $search is not filtering - every result below is meaningless' }

# POSITIVE CONTROL: a string you know is present must return non-zero.
$pos = Search-Mailbox $upn 'Microsoft'
if ($pos.Count -eq 0) { throw 'ABORT: $search returns nothing even for known-present text' }

foreach ($t in $terms) {
  $r = Search-Mailbox $upn $t     # single quoted term, no OR
  "{0,-20} -> {1} hit(s)" -f $t, $r.Count
}
```

## NOTES
- **Always bracket a mailbox sweep with both controls.** A negative control (nonsense term must return 0) catches the dropped-filter bug; a positive control (known-present term must return >0) catches the opposite failure where you conclude "clean" from a query that silently matches nothing. An investigation conclusion without both is unfalsifiable.
- `$search` on messages does index the **body**, not just the subject. Do not dismiss a hit because the subject looks unrelated -- searching `"Washington Gas"` legitimately returns AP mail whose bodies mention the utility.
- `$search` and `$filter` cannot be combined on `/messages`. To scope by date, use `$filter=receivedDateTime ge ...` with `$orderby` and page, as a separate query.
- Mail `$search` is KQL, not OData. If you need OR semantics, either issue one request per term, or use KQL property syntax (`body:foo`) and verify against the controls above before trusting a single result.
- Related: [Always use -All or follow @odata.nextLink](pagination.md), [URL-encode single quotes as %27 in filter queries](filter-encoding.md).
