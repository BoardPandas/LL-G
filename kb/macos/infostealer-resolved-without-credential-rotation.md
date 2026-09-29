---
tech: macos
tags: [infostealer, amos, huntress, incident-response, credential-rotation, launchagent, clickfix]
severity: high
---
# Closing an infostealer incident does not undo the credential theft

## PROBLEM
An EDR (e.g. Huntress) flags a macOS infostealer such as AMOS: usually a ClickFix-style
`curl ... | bash` pasted into Terminal, which drops a random-named LaunchAgent that runs an
inline base64 payload through `osascript` to reach C2. The persistence gets removed and the
incident is marked resolved. It looks finished.

It is not. The stealer already exfiltrated at execution time: browser-saved passwords and
cookies, the login keychain, Notes, and documents. Deleting the LaunchAgent removes the
foothold but leaves every stolen credential valid. Stolen logs are often sold and used months
later, so the attack arrives long after the ticket is closed and nobody connects the two.

Observed case: incident resolved in May with no rotation; M365 passwords and ~180 Chrome-saved
logins (including the bank) stayed unchanged. In September attackers signed in with the
correct M365 passwords from abroad (Entra error 50074, stopped only by MFA push) and the bank
locked the business account for "malware on a device". The EDR agent also lacked Full Disk
Access and its system extension at infection time, so there was no telemetry of what left.

## WRONG
```text
EDR alert: macOS infostealer, LaunchAgent ~/Library/LaunchAgents/com.<random>.plist
-> delete plist, reboot
-> mark incident Resolved
(done)
```

## RIGHT
```text
EDR alert: macOS infostealer
1. Remove persistence (plist, payload, /tmp and Downloads artifacts); scan again.
2. Treat EVERYTHING the host stored as stolen, and rotate it from a DIFFERENT, clean device:
   - every password saved in every browser profile on that Mac (count them)
   - the macOS login password, Apple ID, password-manager master password
   - M365/IdP password, then revoke sessions (stolen cookies bypass MFA)
3. Tell the user to call the bank and review recent activity.
4. Check the EDR agent is actually healthy (Full Disk Access + system extension approved).
5. Only then resolve, and record the rotation in the ticket.
```

## NOTES
- A different password on one site does not protect it if both were saved in the browser;
  "we used a different password for the bank" is irrelevant to an infostealer.
- To date an infection, compare the plist creation time in the EDR report with birth times of
  hidden files in the home folder (`stat -f %SB`); AMOS-style droppers leave small hidden files
  seconds after the plist. Chrome keeps only ~90 days of history, so look early.
- An Entra `lastPasswordChangeDateTime` older than the infection date proves no rotation happened.
