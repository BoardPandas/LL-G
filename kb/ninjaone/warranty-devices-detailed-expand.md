---
tech: ninjaone
tags: [warranty, devices-detailed, references, asset-age, api-v2, expand]
severity: high
---
# Device warranty lives in references.warranty via /devices-detailed?expand=warranty

## PROBLEM
NinjaOne exposes real manufacturer warranty and purchase dates, but they are easy to miss and easy to wrongly conclude do not exist:
- Warranty is NOT a custom field.
- It is NOT returned by `GET /device/{id}` (the `get_device` MCP tool).
- It is omitted from `GET /devices-detailed` UNLESS you pass `expand=warranty`.

Without the `expand` param the response simply has no warranty data, leading you to fall back to unreliable model-release-era or OS-install-date guesses for device age. (OS install date also resets on reimage, so it is a poor age proxy.)

## WRONG
```text
GET /v2/device/1242                      # no warranty anywhere in the response
GET /v2/devices-detailed?df=org = 30     # also has NO warranty object without expand
# -> conclude "NinjaOne has no warranty data" and estimate age from the model name
```

## RIGHT
```text
GET /v2/devices-detailed?df=org = 30&expand=warranty
# each device now has:
#   device.references.warranty = {
#     "startDate": 1695099600,                  # epoch seconds, ~= purchase date
#     "endDate": 1789880399,                    # epoch seconds, warranty end
#     "manufacturerFulfillmentDate": 1695099600
#   }
# Use startDate as the age/purchase anchor and endDate as the support-status anchor.
```

## NOTES
- Values are epoch seconds; `0` or an absent object means "not looked up" for that device.
- Virtual machines and Apple devices typically have no warranty record (no Dell/HP/MS lookup).
- `/devices-detailed` for a whole org is large (100KB+); it will exceed the inline tool limit and be saved to a file. Parse `references.warranty` from the file with a small script (convert epoch with `[DateTimeOffset]::FromUnixTimeSeconds`) instead of loading it all into context.
