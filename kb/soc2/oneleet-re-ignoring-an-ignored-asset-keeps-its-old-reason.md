---
tech: soc2
tags: [oneleet, monitor, ignore, asset, reason, audit-evidence, idempotent, silent-failure]
severity: medium
---
# Oneleet: re-ignoring an already-ignored monitor asset keeps its old reason

## PROBLEM
An ignored asset on a Oneleet monitor carries the reason it was ignored with. Calling the ignore
endpoint again with a new reason returns HTTP 204, but the stored reason does not change. The
asset looks updated in the call and stays on the old reason in the portal and in every read-back.
An audit reader sees the stale reason, and nothing reports the failed update.

To change the reason, un-ignore the asset first, then ignore it again with the new reason. Each
call returns 204. The un-ignore leaves the asset briefly live, so it can alert for a moment.

## WRONG
```
# Returns 204, but the asset keeps its original reason
oneleet__MonitorUpdateIgnoreStatusForAssets(
  monitor, assetsToIgnore=[assetInstanceId], assetsToUnignore=[], reasonToIgnore="new reason")
```

## RIGHT
```
# 1. Un-ignore the asset (204)
oneleet__MonitorUpdateIgnoreStatusForAssets(
  monitor, assetsToIgnore=[], assetsToUnignore=[assetInstanceId], reasonToIgnore="")

# 2. Ignore it again with the new reason (204)
oneleet__MonitorUpdateIgnoreStatusForAssets(
  monitor, assetsToIgnore=[assetInstanceId], assetsToUnignore=[], reasonToIgnore="new reason")

# 3. Read it back. Confirm the reason field shows the new text.
oneleet__MonitorAssetResultList(monitor, search=<asset name>)
```

## NOTES
- Every write returns 204 with no body, so a 204 does not prove the reason changed. Read it back.
- Ignoring an asset also ends any snooze and resets how long it has been alerting for SLA purposes.
- Between steps 1 and 2 the asset is live. Do the two calls in quick succession, and check
  `statusChangedAt` and the monitor counts afterwards.
- Read the reason back before relying on it in an audit. Its text is evidence of the decision behind
  the ignore, so keep it current.
