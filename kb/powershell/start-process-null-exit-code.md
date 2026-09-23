---
tech: powershell
tags: [windows-powershell, start-process, native-tests, exit-code, verification]
severity: high
---
# Start-Process followed by WaitForExit can leave ExitCode null

## PROBLEM

A native test executable can finish and print PASS while the Process object
returned by Start-Process -PassThru reports a null ExitCode after a separate
WaitForExit and Refresh. Observed in Windows PowerShell 5.1 during a protected
Windows native test run. The receipt looked complete but contained ExitCode:null.
That is missing exit evidence, not zero. Casting null to an integer would turn
this into a false success.

The exact process-handle race was not isolated. The observed failing sequence
and the successful rerun are sufficient to keep the validation rule narrow:
require a real exit value, and do not infer it from stdout or process absence.

## WRONG

```powershell
$p = Start-Process -FilePath $exe -ArgumentList '-test.v','-test.timeout=45s' `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$p.WaitForExit(55000) | Out-Null
$p.Refresh()
[int]$code = $p.ExitCode # null silently becomes 0
if ($code -eq 0) { 'PASS' }
```

## RIGHT

For a bounded test executable, wait as part of Start-Process and reject a missing
exit value. Keep stdout and stderr separate under ErrorActionPreference=Stop.

```powershell
$p = Start-Process -FilePath $exe -ArgumentList '-test.v','-test.timeout=45s' `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Wait -PassThru
$code = $p.ExitCode
if ($null -eq $code) { throw 'Native process exit code was not observed' }
if ($code -ne 0) { throw "Native tests failed with exit code $code" }
```

## NOTES

- In the observed rerun, all 24 tests passed, no tests skipped, and ExitCode was 0.
  Retain the first incomplete receipt; it did not prove a successful exit.
- Start-Process -Wait can also wait for descendants. Bound the executable and
  surrounding command; do not use an unbounded wait for arbitrary native work.
- For an asynchronous launch needing an explicit external deadline, retain a
  valid process handle before exit and verify the actual native exit result.
- A test runner exit of zero still does not prove test discovery or coverage.
  Check named test results and skips as well.
