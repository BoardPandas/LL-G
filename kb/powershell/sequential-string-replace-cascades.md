---
tech: powershell
tags: [templating, string-replace, hashes, integrity-pins, code-generation]
severity: high
---
# Sequential String.Replace maps can rewrite newly inserted values

## PROBLEM
A loop that applies raw `String.Replace(old, new)` pairs one after another can process text that an earlier replacement just inserted. This silently corrupts generated hashes, IDs, paths, or byte counts when a later old token happens to occur inside an earlier new value.

For example, inserting a SHA containing `4738` and then replacing the old byte-count token `4738` with `5125` changes the SHA itself. The generated script still parses, and the corruption may not appear until a remote integrity check fails.

## WRONG
```powershell
foreach ($entry in $replacements.GetEnumerator()) {
  $text = $text.Replace([string]$entry.Key, [string]$entry.Value)
}
```

## RIGHT
```powershell
$replacements = [ordered]@{
  '{{LAUNCHER_SHA256}}' = $launcherSha256
  '{{APPROVAL_BYTES}}' = [string]$approvalBytes
}

foreach ($entry in $replacements.GetEnumerator()) {
  $token = [string]$entry.Key
  if ([regex]::Matches($text, [regex]::Escape($token)).Count -ne 1) {
    throw "Expected exactly one template token: $token"
  }
  $text = $text.Replace($token, [string]$entry.Value)
}

if ($text -match '\{\{[A-Z0-9_]+\}\}') {
  throw 'An unresolved template token remains'
}
```

## NOTES
Prefer unique, delimited template tokens or structured JSON/object mutation over replacing previous literal values. If a legacy raw-value mapper cannot be removed immediately, use collision-proof temporary placeholders, process source keys longest-first, and independently compare every rendered integrity pin with the actual file before execution.
