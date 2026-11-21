---
tech: gcloud
tags: [gcloud, google-cloud, windows, git-bash, python, windows-store-stub, cloudsdk-python]
severity: medium
---
# gcloud in Git Bash picks the Windows Store python stub and fails before running

## PROBLEM
On Windows, the Cloud SDK's bash `gcloud` script (used by Git Bash) looks for `python` on PATH.
`%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe`, the Microsoft Store app-execution alias, usually
comes first. Every gcloud command then prints "Python was not found; run without arguments to install
from the Microsoft Store..." and does nothing. This happens even when real Python installs exist and the
SDK ships its own interpreter in `platform/bundledpython`. `gcloud.cmd` from PowerShell can work in the
same moment, so the install looks fine everywhere except Git Bash, and agent shells are often Git Bash.

## WRONG
```bash
gcloud --version
# Python was not found; run without arguments to install from the Microsoft Store, ...
```

## RIGHT
```bash
# Point gcloud at the SDK's bundled interpreter (adjust for a per-user install path)
export CLOUDSDK_PYTHON="/c/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe"
gcloud --version   # must print "Google Cloud SDK <version>"
```

## NOTES
- To make it persistent, set `CLOUDSDK_PYTHON` as a user environment variable, or disable the `python.exe`
  alias in Settings > Apps > Advanced app settings > App execution aliases.
- The stub is the same one behind the bash entry
  [`command -v` finds a Windows Store alias stub](../bash/command-v-finds-nonexecuting-stub.md).
- Even once gcloud runs, an expired login fails non-interactively with "Reauthentication failed. cannot
  prompt during non-interactive execution". Only an interactive `gcloud auth login` fixes that.
