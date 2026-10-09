---
tech: powershell
tags: [validation, json, arrays, comparison, security]
severity: high
---
# Validate scalar types before allowlist comparisons

## PROBLEM

PowerShell comparison operators do not always return a Boolean. When their
left operand is a collection, equality and inequality operators return matching
elements instead. In particular, comparing an array containing only the allowed
string with `-cne` produces no elements. An `if` rejection check then treats the
result as false and silently accepts the array as though it were a valid scalar.

Case-sensitive comparison does not validate the input type. This matters for
JSON protocol fields, configuration enums and other allowlists where an attacker
or malformed producer can supply an array in place of a required string.

## WRONG

```powershell
$payload = '{"awareness":["per-monitor-v2"]}' | ConvertFrom-Json
$value = $payload.awareness

if ($value -cne 'per-monitor-v2') {
    throw 'Unsupported awareness'
}

# Accepted, although the JSON field is an array, not a string.
```

A positive equality check has a related trap: a collection containing an allowed
element can return that element and become truthy, even if other elements are
not allowed. Casting the value to `[string]` first also discards the original type
and is not a schema check.

## RIGHT

```powershell
$payload = '{"awareness":["per-monitor-v2"]}' | ConvertFrom-Json
$value = $payload.awareness

if ($value -isnot [string] -or $value -cne 'per-monitor-v2') {
    throw 'Expected one allowed awareness string'
}

# Rejected. The same guard accepts the scalar "per-monitor-v2".
```

Validate the original scalar type before checking membership or value. For an
allowlist with multiple permitted strings, retain the string-type guard and use
an explicit membership check. Numeric fields need their own strict type and
bounds validation; do not coerce arrays, numeric strings or Booleans to integers
merely to make the later comparison work.

## NOTES

- Add a failing regression with an array containing only the allowed string.
  Happy-path tests and a different scalar string do not exercise this defect.
- Also cover empty arrays, mixed arrays, null, missing fields, numeric values,
  Booleans and case variants as required by the schema.
- Exercise each supported PowerShell runtime. SupportForge's array-refusal
  regression was verified locally in PowerShell 7 and natively in Windows
  PowerShell 5.1, with both runtimes also covered by Windows CI.
- The verified case was a physical-pixel fixture geometry receipt. Accepting the
  correct string is only one schema check; it does not establish process
  ownership, authenticated provenance or validity of the surrounding evidence.
- [Regression at the verified SupportForge commit](https://github.com/BoardPandas/supportforge-platform/blob/9f04e577dc2eb1bb96ab3ae5a3efd7a48c760d9c/desktop_agent_v2/tools/remote-viewer-acceptance/source-packet.test.ps1#L51).
- [Strict scalar guard at the same commit](https://github.com/BoardPandas/supportforge-platform/blob/9f04e577dc2eb1bb96ab3ae5a3efd7a48c760d9c/desktop_agent_v2/tools/remote-viewer-acceptance/FixtureSourcePacket.ps1#L87).
