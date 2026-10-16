---
tech: macos
tags: [notarization, stapler, notarytool, cloudkit, github-actions, release, codesign, dmg, retry]
severity: high
---
# stapler staple and validate fail on a dropped CloudKit lookup after notarization is Accepted

## PROBLEM
`xcrun stapler staple` and `xcrun stapler validate` BOTH fetch the notarization
ticket from Apple's CloudKit
(`api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup`),
a different service from `notarytool`. That lookup can drop mid-request:

```
error is Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."
CloudKit's response is inconsistent with expections: (null)
The staple and validate action failed! Error 68.
```

It happens AFTER `notarytool submit --wait` reports `status: Accepted`, so the
package is fine and the release still fails. On GitHub macOS runners on
2026-10-15 it hit the same DMG three times in a row: once in `staple`, once in
`validate` straight after a staple that had worked, and once more in `staple`,
which then succeeded on the second try. Retrying only `staple` is not enough.

Re-running the failed job does not pick up a fixed script. The re-run, and a
`workflow_dispatch` that checks out the tag, rebuild the TAG's commit. A
packaging fix only reaches users through a new tag.

## WRONG
```bash
xcrun notarytool submit "$dmg" --keychain-profile "$profile" --wait
xcrun stapler staple "$dmg"     # one network attempt
xcrun stapler validate "$dmg"   # a second, separate network attempt
```

## RIGHT
```bash
# bash 3.2 compatible (macOS /bin/bash). Retry the lookup only, never resubmit.
stapler_retry() {
    local attempt
    for attempt in 1 2 3 4; do
        if /usr/bin/xcrun stapler "$1" "$2"; then
            return 0
        fi
        [[ $attempt -lt 4 ]] || break
        echo "stapler $1 failed (attempt $attempt of 4); retrying in $((attempt * 15)) s" >&2
        sleep $((attempt * 15))
    done
    return 1
}
xcrun notarytool submit "$dmg" --keychain-profile "$profile" --wait
stapler_retry staple "$dmg"
stapler_retry validate "$dmg"
```

## NOTES
- Wrap every stapler call: the app bundle and the DMG, staple and validate.
- Never resubmit to `notarytool` on a stapler failure. The ticket already exists,
  and a resubmission adds minutes plus another chance to fail.
- Re-stapling an already-stapled file is safe: it replaces the ticket.
- Under `set -e`, keep the stapler call inside `if` in the function so a failed
  attempt does not exit the script before it retries.
- Seen in Hark v0.62.4 (failed twice) and fixed in v0.62.6, where attempt 1 of the
  DMG staple failed again and attempt 2 worked.
