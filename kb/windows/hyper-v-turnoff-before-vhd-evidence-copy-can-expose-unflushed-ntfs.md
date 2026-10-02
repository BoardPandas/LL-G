---
tech: windows
tags: [hyper-v, ntfs, vhdx, evidence, powershell]
severity: medium
---
# Hyper-V TurnOff before a VHD evidence copy can expose unflushed NTFS

## PROBLEM
Immediately powering off a running guest with `Stop-VM -TurnOff -Force` and then mounting its VHDX read-only can make a newly written evidence directory report "The file or directory is corrupted and unreadable." The guest may still remount the same volume and read every file because Windows finishes or replays filesystem work during a normal boot. This is easy to misdiagnose as a damaged checkpoint or lost evidence when the real problem is the hard-power-off copy boundary.

## WRONG
```powershell
Stop-VM -Name $vmName -TurnOff -Force
$vhd = Mount-VHD -Path $diskPath -ReadOnly -PassThru
Copy-Item -LiteralPath $evidenceRoot -Destination $archive -Recurse
```

## RIGHT
```powershell
# Run inside the guest while its command channel is still healthy.
shutdown.exe /s /t 0 /f /d p:0:0 /c 'Flush evidence before offline copy'

# Run on the Hyper-V host. Wait for a real graceful-off state before mounting.
$deadline = [DateTime]::UtcNow.AddMinutes(2)
do {
  Start-Sleep -Seconds 2
  $vm = Get-VM -Name $vmName
} while ($vm.State -ne 'Off' -and [DateTime]::UtcNow -lt $deadline)
if ($vm.State -ne 'Off') {
  throw 'Guest did not complete the evidence-preserving shutdown'
}

$vhd = Mount-VHD -Path $diskPath -ReadOnly -PassThru
Copy-Item -LiteralPath $evidenceRoot -Destination $archive -Recurse
```

## NOTES
Preserve the failed mount result before retrying. If the guest is still bootable, restart it, verify the indexed evidence tree from inside the guest, then request a graceful guest shutdown and retry the read-only copy. Reserve `-TurnOff` for an unresponsive guest or for the later checkpoint rollback after evidence is already safe; it is the virtual equivalent of removing power.
