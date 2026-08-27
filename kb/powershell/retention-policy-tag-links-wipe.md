---
tech: powershell
tags: [exchange-online, retention-policy, mrm, set-retentionpolicy, silent-failure, compliance]
severity: high
---
# Set-RetentionPolicy wipes every tag link when the array is built from $_.Name

## PROBLEM
`Get-RetentionPolicy` returns `RetentionPolicyTagLinks` as objects whose `.Name`
property evaluates to an **empty string**. The objects render fine when printed
(their `ToString()` gives the tag name), so the collection looks correct in the
console -- but projecting `.Name` off it silently yields a bag of `''`.

`Set-RetentionPolicy -RetentionPolicyTagLinks` then **accepts that array without
error** and removes every existing tag link from the policy.

The read-modify-write "append one tag" pattern is therefore a policy wipe. On
`Default MRM Policy` -- which is assigned to every mailbox in a tenant by default --
this instantly disables the Deleted Items purge and every personal archive tag across
the whole organisation. `Get-RetentionPolicy` afterwards shows `Count: 0`.

The debugging tell that makes it obvious in hindsight: the "current links" line logs as
`, , , ,` -- commas with nothing between them.

Blast radius is worth knowing precisely: the failure mode is *"policy stops acting"*,
not *"policy deletes the wrong thing"*. With zero tags linked the Managed Folder
Assistant applies no retention action at all, so no mail is destroyed. It is a silent
compliance outage, not data loss -- but nothing warns you it happened.

## WRONG
```powershell
$pol   = Get-RetentionPolicy -Identity 'Default MRM Policy'
$links = @($pol.RetentionPolicyTagLinks | ForEach-Object { $_.Name })   # all ''
Set-RetentionPolicy -Identity 'Default MRM Policy' `
    -RetentionPolicyTagLinks @($links + 'Default 1 year move to archive')
# succeeds; policy now has ONE tag (or zero) instead of the original five
```

## RIGHT
```powershell
# Pass tag names as literal strings. Never derive them from .Name
$restore = @(
    'Trash',
    '7 Day move to archive',
    '6 Month move to archive',
    '90 Day move to archive',
    'Default 1 year move to archive'
)
Set-RetentionPolicy -Identity 'Default MRM Policy' -RetentionPolicyTagLinks $restore -ErrorAction Stop

# Always verify the count after any write
$after = @( (Get-RetentionPolicy -Identity 'Default MRM Policy').RetentionPolicyTagLinks )
if ($after.Count -ne $restore.Count) {
    throw "Tag links wrong: expected $($restore.Count), got $($after.Count)"
}
$after | ForEach-Object { $_.ToString() }   # ToString() reads correctly; .Name does not
```

## NOTES
- Read tag names back with `$_.ToString()`, never `$_.Name`.
- Capture the original link list **before** any modification so a restore is possible.
  Recovery is easy only if you know what the five tags were.
- Same class of bug as
  [Member enumeration on an array returns every element's value](member-enumeration-concatenation.md):
  a property projection that yields empty/blank instead of throwing, feeding a
  destructive write that accepts it.
- `Set-RetentionPolicy -RetentionPolicyTagLinks` is a full replace, not an append.
  There is no `-AddRetentionPolicyTag` parameter, which is what pushes people into the
  read-modify-write pattern in the first place.
