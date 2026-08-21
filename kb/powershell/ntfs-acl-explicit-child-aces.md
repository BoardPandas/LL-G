---
tech: powershell
tags: [ntfs, acl, permissions, icacls, get-acl, set-acl, inheritance, file-shares, security]
severity: high
---
# AreAccessRulesProtected = $false does not mean a child lacks its own explicit ACEs

## PROBLEM

When stripping a principal (`Everyone`, `Domain Users`) from a share tree, the natural pre-flight
check is "do the children inherit?" -- because if they do, editing the root propagates everywhere.
`(Get-Acl $path).AreAccessRulesProtected` answers that question and returning `$false` feels like
a green light.

It is not. `AreAccessRulesProtected` reports **only** whether the inheritance-disabled flag is set
on that object. It says nothing about whether the child *also* carries its own **explicit** ACE for
the same principal. Both can be true at once, and that combination is extremely common on shares
that grew organically -- someone right-clicked a subfolder years ago and added `Everyone` there too.

The failure is silent and total:

1. You remove `Everyone` at the root. `Get-Acl` on the root now looks clean.
2. Every subfolder still has its own explicit `Everyone: FullControl`.
3. Worse, each of those explicit child ACEs carries `ContainerInherit, ObjectInherit`, so it
   **re-propagates down to every file beneath it as an inherited ACE**.
4. Nothing errors. You report the permission fix as complete while the entire tree is still exposed.

Found on a live file server during pen-test remediation: 1,117 subfolders and 8,130 member invoice
PDFs behind `Everyone: FullControl`. All 1,117 subfolders reported `AreAccessRulesProtected = $false`.
All 1,117 also had their own explicit `Everyone` ACE. The root-level fix changed nothing that mattered
and was only caught by spot-checking a child after the change.

The second half of the trap is the backup. `icacls <path> /save` **without `/T`** records the root
object only, so it cannot restore child ACEs -- which is precisely the state you need to roll back to
in this scenario.

## WRONG

```powershell
# Pre-flight: "do the children inherit?" -- if yes, editing the root propagates.
$protected = @(Get-ChildItem 'C:\catering\Invoices' -Directory -Recurse |
    Where-Object { (Get-Acl $_.FullName).AreAccessRulesProtected })
"inheritance broken on: $($protected.Count)"    # -> 0. Looks safe. It is not.

# Root-only backup -- useless for rolling back child ACEs.
icacls 'C:\catering\Invoices' /save C:\Windows\Temp\acl.txt

$p = 'C:\catering\Invoices'
$acl = Get-Acl $p
@($acl.Access | Where-Object { $_.IdentityReference.Value -eq 'Everyone' }) |
    ForEach-Object { [void]$acl.RemoveAccessRule($_) }
Set-Acl -Path $p -AclObject $acl

(Get-Acl $p).Access | Where-Object { $_.IdentityReference.Value -eq 'Everyone' }
# -> nothing. Root is clean, so the fix is reported as done.
#
# Reality: all 1,117 subfolders still carry their OWN explicit Everyone:FullControl,
# re-propagating to 8,130 files as inherited ACEs. Zero errors, zero warnings.
```

## RIGHT

```powershell
$p = 'C:\catering\Invoices'

# 1. RECURSIVE backup first. /T is not optional -- without it you cannot restore
#    child ACEs. 9,256 objects took 0.9s and 5.3 MB. There is no reason to skip it.
icacls $p /save C:\Windows\Temp\acl_FULL.txt /T /C

# 2. Strip the principal TREE-WIDE. /remove:g removes explicit grant ACEs at every
#    level; inherited copies vanish once their source explicit ACE is gone.
#    9,256 objects in 5.7s.
icacls $p /remove:g Everyone /T /C

# 3. Re-grant the intended access once, at the root, and let it inherit.
$acl = Get-Acl $p
[void]$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    'NT AUTHORITY\Authenticated Users', 'ReadAndExecute',
    'ContainerInherit, ObjectInherit', 'None', 'Allow')))
Set-Acl -Path $p -AclObject $acl

# 4. VERIFY BY SWEEPING THE TREE -- never by re-reading the object you just edited.
$hits = 0
foreach ($i in @(Get-Item $p) + @(Get-ChildItem $p -Recurse -ErrorAction SilentlyContinue)) {
    if ((Get-Acl $i.FullName).Access |
        Where-Object { $_.IdentityReference.Value -eq 'Everyone' }) { $hits++ }
}
"objects still granting Everyone: $hits"    # must be 0

# Rollback:
#   icacls C:\catering /restore C:\Windows\Temp\acl_FULL.txt /C
#   (restore targets the PARENT of the saved path)
```

## NOTES

- **`/remove:g` vs `/remove`.** `/remove:g` removes grant (allow) ACEs, `/remove:d` removes deny
  ACEs, bare `/remove` removes both. Be explicit about which you mean.
- **`icacls /restore` targets the parent directory**, not the saved path. The save file records
  paths relative to the parent, so `icacls C:\catering /restore <file>` restores
  `C:\catering\Invoices` and everything under it.
- **An ACE with `InheritanceFlags = None` on a directory grants that folder only.** The mirror-image
  mistake to this entry: reading `Domain Users: ReadAndExecute` on a share root as "everyone can read
  everything in here" and writing a critical finding. Check the inheritance flags, then check whether
  children break inheritance -- either one can reverse the conclusion. In the same engagement, a
  finding claiming all 211 users could read HR investigation files was wrong on both counts: the root
  ACE was folder-only, and the sensitive subfolder broke inheritance and was scoped to 13 named users.
  Acting on the finding as written would have broken legitimate access.
- **Use ownership to find out who actually uses a share** before scoping write access. Sweeping
  `(Get-Acl $_.FullName).Owner` across the tree identifies the real writers in one pass, and often
  reveals that most of them are disabled leavers -- which makes tightening safe. Far faster than
  auditing access logs or asking around.
- **Distribution groups cannot be used in an NTFS ACL at all.** Check `(Get-ADGroup X).GroupCategory`
  before planning a permission model around a promising-looking group name.
- **When you cannot scope read access safely, still remove write.** Dropping
  `Everyone: FullControl` to `Authenticated Users: ReadAndExecute` kills the delete/ransomware
  exposure immediately even if "who should be able to read this" is still an open business question.
- Related: share-level and NTFS ACLs combine as the *most restrictive* of the two. Neither is a
  finding on its own -- compute the effective permission from both layers before assigning severity.
