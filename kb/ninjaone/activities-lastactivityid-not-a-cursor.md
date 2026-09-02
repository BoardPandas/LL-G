---
tech: ninjaone
tags: [api, activities, paging, olderThan, lastActivityId]
severity: high
---
# /v2/activities lastActivityId is the newest id in the tenant, not a page cursor

## PROBLEM
`GET /v2/activities` returns `{ activities: [...], lastActivityId: N }`. It is natural to read `lastActivityId` as "the last id on this page" and page backwards with `olderThan=lastActivityId`. It is not. It is the highest activity id in the whole tenant (it is greater than every id on the page you just received). `olderThan=lastActivityId` therefore returns an empty page and a loop that stops on an empty page silently reports only the first page, which on a busy tenant is one day of data.

Observed 2026-09-02 on a tenant logging roughly 1000 activities a day: page 1 covered 38 hours, `lastActivityId` was 96 higher than the page's max id, and page 2 came back empty. A report built on that saw 1 of 150 machines.

The `sourceConfigUid` query parameter is also ignored on this endpoint (verified: the response contained activities from other scheduled tasks and other organisations). Filter client-side.

## WRONG
```powershell
$olderThan = $null
do {
    $r = Invoke-RestMethod "$base/v2/activities?class=DEVICE&status=COMPLETED&pageSize=1000&olderThan=$olderThan"
    # ... use $r.activities ...
    $olderThan = $r.lastActivityId     # newest id in the tenant, page 2 is empty
} while (@($r.activities).Count -ge 1000)
```

## RIGHT
```powershell
$olderThan = $null
do {
    $path = "$base/v2/activities?class=DEVICE&status=COMPLETED&pageSize=1000"
    if ($null -ne $olderThan) { $path += "&olderThan=$olderThan" }
    $r = Invoke-RestMethod $path
    $acts = @($r.activities)
    $pageMinId = ($acts | ForEach-Object { [long]$_.id } | Measure-Object -Minimum).Minimum
    # ... use $acts ...
    $olderThan = $pageMinId            # smallest id on THIS page
} while ($acts.Count -ge 1000)
```

## NOTES
- Pages overlap slightly in time (ids are not strictly time-ordered), so when applying a date cutoff, skip old rows rather than break on the first one, and stop when the page's newest row is older than the cutoff.
- `activityResult` (SUCCESS / FAILURE) is the reliable outcome flag. `status=COMPLETED` includes failures.
- The MCP `ninjaone_api_call` and `ninjaone_get_device_activities` results blow the tool output limit quickly at pageSize 1000. Save to a file and parse with a script.
