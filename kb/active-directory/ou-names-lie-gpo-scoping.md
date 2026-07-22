---
tech: active-directory
tags: [active-directory, group-policy, gpo, ou, security-filtering, ms16-072, kerberos, cn-computers]
severity: high
---
# OU names lie: never scope a risky GPO by OU without auditing what is actually in it

## PROBLEM

Targeting a GPO by OU assumes the OU contains what its name says. In any domain more than a few years old that assumption is usually wrong, and the failure is silent in both directions: machines you meant to hit are missed, and machines you meant to spare get the policy anyway.

Two specific traps, and they frequently coexist:

**1. The OU contains things its name excludes.** An OU named `Office Workstations` held 113 objects, of which only 22 had logged on in 30 days, **and it contained live POS terminals**. Linking a policy that force-restarts an application to that OU would have hit registers mid-service, which for a hospitality site is worse than the problem being fixed.

**2. Machines you care about are not in any OU at all.** 33 active machines, including the one belonging to the user who raised the ticket, sat in `CN=Computers`. That is the default *container*, not an organizational unit, and **you cannot link a GPO to it**. Anything parked there receives only Default Domain Policy, forever, silently. Machines land there whenever they are domain-joined without a `redircmp` redirect in place.

Net effect: the "obvious" OU link would have covered a minority of the live fleet, missed the actual complainant, and hit the exact machines that were supposed to be excluded. Everything would have reported success.

## WRONG

```powershell
# Assuming the OU name describes its contents, and linking a disruptive policy to it.
New-GPLink -Name 'Force App Relaunch' `
           -Target 'OU=Office Workstations,OU=Computers,OU=BHCC,DC=corp,DC=com'
# Silently hits live POS terminals sitting in that OU,
# and silently misses every machine parked in CN=Computers.

# Equally wrong: "just link it at the domain root" with no filtering,
# which hits servers, DCs, kiosks and POS alike.
New-GPLink -Name 'Force App Relaunch' -Target 'DC=corp,DC=com'
```

## RIGHT

```powershell
$ou = 'OU=Office Workstations,OU=Computers,OU=BHCC,DC=corp,DC=com'

# 1. AUDIT the OU before trusting it. What is in there, and is any of it alive?
$all = Get-ADComputer -Filter * -SearchBase $ou -SearchScope Subtree -Properties LastLogonDate,OperatingSystem
"total: $($all.Count)  active(30d): $(@($all | Where-Object { $_.LastLogonDate -gt (Get-Date).AddDays(-30) }).Count)"
$all | Where-Object { $_.Name -match 'POS|KIOSK|KITCH|BAR|REGISTER' } |
    ForEach-Object { "EXCLUDE-CANDIDATE: $($_.Name)  $($_.LastLogonDate)" }

# 2. Find everything stranded in the un-linkable default container.
Get-ADComputer -Filter * -SearchBase 'CN=Computers,DC=corp,DC=com' -SearchScope OneLevel -Properties LastLogonDate |
    Where-Object { $_.LastLogonDate -gt (Get-Date).AddDays(-30) } | Select-Object Name

# 3. When OUs cannot express the target, use an explicit include GROUP and
#    link high enough to reach machines wherever they sit.
$grp = 'SEC-AppRelaunch-Computers'
New-ADGroup -Name $grp -GroupScope Global -GroupCategory Security -Path 'OU=Groups,DC=corp,DC=com'
$include = Get-ADComputer -Filter * -Properties LastLogonDate,OperatingSystem | Where-Object {
    $_.LastLogonDate -gt (Get-Date).AddDays(-30) -and
    $_.OperatingSystem -notlike '*Server*' -and
    $_.DistinguishedName -notmatch 'OU=POS Workstations|OU=Domain Controllers' -and
    $_.Name -notmatch 'POS|KIOSK|KITCH|BAR|REGISTER' }
Add-ADGroupMember -Identity $grp -Members $include

# 4. Filter to the group. CRITICAL: Authenticated Users must KEEP Read (lose only Apply),
#    or MS16-072 makes the GPO silently stop applying to everyone.
Set-GPPermission -Name 'Force App Relaunch' -TargetName $grp -TargetType Group -PermissionLevel GpoApply -Replace
Set-GPPermission -Name 'Force App Relaunch' -TargetName 'Authenticated Users' -TargetType Group -PermissionLevel GpoRead -Replace
New-GPLink -Name 'Force App Relaunch' -Target 'DC=corp,DC=com' -LinkEnabled Yes

# 5. VERIFY the filter held, rather than trusting the intent.
Get-GPPermission -Name 'Force App Relaunch' -All | Where-Object { $_.Permission -eq 'GpoApply' }
Get-ADGroupMember -Identity $grp | Where-Object { $_.Name -match 'POS|KIOSK|REGISTER' }   # must be empty
```

## NOTES

**Computer group membership requires a REBOOT, not `gpupdate`.** The machine's Kerberos ticket has to refresh before the new group appears in its token, so a filtered GPO appears completely broken right after you build it. This wastes a lot of time if you do not know it. To test immediately without waiting for a restart:

```powershell
klist -li 0x3e7 purge          # purge the COMPUTER account's tickets (0x3e7 = SYSTEM)
gpupdate /target:computer /force
```

**MS16-072 is the one to remember.** Stripping Authenticated Users entirely from a GPO's ACL is the intuitive way to security-filter, and it breaks the GPO for everyone because computers need Read to process it. Downgrade to Read, or grant `Domain Computers` Read. There is no error, it just stops applying.

**A domain-root link with a tight include-group filter is safe, and is often the only thing that reaches `CN=Computers`.** The blast radius is the group membership, not the link location. Prefer it over moving computer objects between OUs in an unfamiliar domain, because moving an object silently changes every policy it inherits.

**An include group is a snapshot, not a rule.** Membership built from "active in the last 30 days" does not update itself. New or rebuilt machines never join. Either review it periodically or drive it from a scheduled job.

**Treat stale-object ratio as a signal.** An OU that is 113 objects but 22 active tells you nobody has curated it in years, which is exactly when its name is least trustworthy. Check `LastLogonDate` before believing any OU-based assumption.

**Fix the structure separately, and never as part of shipping the policy.** Redirect future joins with `redircmp "OU=Workstations,DC=corp,DC=com"`, then move stranded machines deliberately after auditing what GPOs they would begin inheriting.
