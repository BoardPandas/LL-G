---
tech: windows
tags: [point-and-print, printnightmare, print-driver, whql, trustedpublisher, 800702e4, event-600, restrictdriverinstallationtoadministrators, pnputil, security]
severity: high
---
# PrintService Event 600 / error 800702e4 is "elevation required", not a bad driver -- non-WHQL Point-and-Print drivers need the publisher cert in TrustedPublisher

## PROBLEM
Standard (non-admin) users get a "Do you trust this printer? / install driver" prompt every time they print to a server-shared printer, and `Microsoft-Windows-PrintService/Admin` fills with **Event ID 600**:

> The print spooler failed to import the printer driver that was downloaded from `\\SERVER\print$\...` into the driver store for driver X. **Error code= 800702e4.** This can occur if there is a problem with the driver or the digital signature of the driver.

The message text sends you hunting a corrupt/unsigned driver. That is a red herring. `0x800702e4` decodes to Win32 error **740 = ERROR_ELEVATION_REQUIRED**.

The real trigger is a print server hosting a driver that is (a) **newer** than the client's copy, so Point-and-Print tries to update it, AND (b) **vendor-signed** (e.g. Kyocera via DigiCert) rather than Microsoft-**WHQL**. Since Windows defaults `RestrictDriverInstallationToAdministrators = 1` (the PrintNightmare / CVE-2021-34527 mitigation), a standard user cannot install/update the driver. A vendor signature being cryptographically Valid (`Get-AuthenticodeSignature` says "Valid") is NOT the same as being trusted for driver *installation*: that needs WHQL, OR the vendor's code-signing cert in `LocalMachine\TrustedPublisher`. Until then `pnputil /add-driver` fails with "The publisher of an Authenticode signed catalog has not yet been established as trusted."

## WRONG
```powershell
# WRONG: believe the Event 600 text, "repair" the driver, get nowhere -- then make the
# prompt vanish by reversing the mitigation fleet-wide:
$k = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Printers\PointAndPrint'
Set-ItemProperty $k -Name RestrictDriverInstallationToAdministrators -Value 0
Set-ItemProperty $k -Name NoWarningNoElevationOnInstall -Value 1
Set-ItemProperty $k -Name NoWarningNoElevationOnUpdate  -Value 1
# Prompt stops -- and ANY standard user can now install an arbitrary print driver as SYSTEM.
# That is exactly the PrintNightmare RCE / domain-compromise vector the default was closing.
```

## RIGHT
```powershell
# 0x800702e4 = ERROR_ELEVATION_REQUIRED. The driver is fine; it's a non-WHQL (vendor-signed)
# Point-and-Print driver a non-admin can't install while the mitigation is on.
# Trust the vendor's publisher cert and KEEP RestrictDriverInstallationToAdministrators = 1.

# Confirm the pattern: signature "Valid" yet not trusted for install; server build newer than client.
$cat = '<expanded-driver-folder>\VENDOR.CAT'
$sig = Get-AuthenticodeSignature $cat        # Status=Valid, Signer = vendor (NOT Microsoft WHQL)

# Add the publisher cert to TrustedPublisher (per machine; fleet = a GPO importing the same .cer)
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('TrustedPublisher','LocalMachine')
$store.Open('ReadWrite'); $store.Add($sig.SignerCertificate); $store.Close()

# Now the driver stages without elevation and Point-and-Print stops prompting.
pnputil.exe /add-driver $infPath /install
```

## NOTES
- Diagnose the version mismatch by comparing the DriverStore FileRepository hash folder (`oemsetup.inf_amd64_<hash>`) and the INF `DriverVer` line on server vs client; **server newer + non-WHQL .cat signer** is the fingerprint. The client's older copy installs fine precisely because it is WHQL.
- Durable alternative: serve a **WHQL-signed** driver from the print server (then no publisher trust is needed at all).
- Fleet rollout: a GPO that imports the vendor cert into Computer Config > Public Key Policies > Trusted Publishers (or a computer **startup script** doing the `X509Store` add). Startup scripts apply at next boot only.
- A SupportForge / PsExec session runs as `NT AUTHORITY\SYSTEM` (session 0) and cannot do an interactive Point-and-Print pull ("driver cannot be retrieved from the server, must be manually installed"); stage from `\\SERVER\print$\<arch>\<env>\<inf>_<arch>_<hash>.cab` with `expand` + `pnputil` instead.
- Discovered: Columbia Country Club, Kyocera ECOSYS PA2600cwx KX, server v8.6 (Kyocera/DigiCert) vs client v8.3 (WHQL), Zendesk 16488, 2026-06-26.
