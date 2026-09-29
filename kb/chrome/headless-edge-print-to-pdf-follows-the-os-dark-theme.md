---
tech: chrome
tags: [edge, chromium, headless, pdf, print, dark-mode]
severity: high
---
# Headless Edge print-to-PDF follows the OS dark theme

## PROBLEM
`msedge --headless --print-to-pdf=...` (and headless Chrome, same engine) evaluates `prefers-color-scheme` from the **Windows theme** of the machine running it. Printing does not reset it to light. So a page whose dark-mode overrides sit under a plain `@media (prefers-color-scheme: dark)` prints with the dark palette on any machine set to dark mode: dark backgrounds, light text, every PDF.

It is silent and machine-dependent. The HTML looks right in a light-themed browser, the PDF is valid, the exit code is 0, and the same script produces a correct PDF on a colleague's light-themed laptop. Nobody suspects the CSS because "print is light".

Two smaller traps on the same path: running headless against the default profile shares state with the Edge window the user already has open, and Edge's headless mode has a **minimum window width of 496 px**, so a narrower `--window-size` is not honoured.

## WRONG
```css
:root { --bg: #ffffff; --ink: #172e50; }
@media (prefers-color-scheme: dark) {              /* also matches while PRINTING on a dark-theme PC */
  :root:not([data-theme="light"]) { --bg: #0f1a2b; --ink: #e8eef6; }
}
body { background: var(--bg); color: var(--ink); }
```

```powershell
& msedge.exe --headless --print-to-pdf="out.pdf" "file:///C:/work/page.html"   # default profile; exit code trusted
```

## RIGHT
```css
:root { --bg: #ffffff; --ink: #172e50; }
@media screen and (prefers-color-scheme: dark) {   /* screen only: print never picks this up */
  :root:not([data-theme="light"]) { --bg: #0f1a2b; --ink: #e8eef6; }
}
:root[data-theme="dark"] { --bg: #0f1a2b; --ink: #e8eef6; }
@media print {                                     /* belt and braces, incl. an explicit dark toggle */
  :root, :root[data-theme="dark"] { --bg: #ffffff; --ink: #172e50; color-scheme: light; }
}
body { background: var(--bg); color: var(--ink); }
```

```powershell
$ErrorActionPreference = 'Stop'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$work = Join-Path ([IO.Path]::GetTempPath()) ('html2pdf-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$pdf = Join-Path $work 'out.pdf'
$uri = ([Uri](Resolve-Path -LiteralPath $html).ProviderPath).AbsoluteUri
# Start-Process does not quote ArgumentList items, so wrap anything that can contain a space.
$edgeArgs = @('--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
              '--no-pdf-header-footer', '--print-to-pdf-no-header',
              "`"--user-data-dir=$work\profile`"",          # throwaway profile: the user's open Edge is untouched
              "`"--print-to-pdf=$pdf`"", "`"$uri`"")
$p = Start-Process -FilePath $edge -ArgumentList $edgeArgs -PassThru -NoNewWindow
$null = $p.Handle                                          # keeps ExitCode readable after exit
if (-not $p.WaitForExit(120000)) { Stop-Process -Id $p.Id -Force; throw 'Edge timed out' }
if ($p.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $pdf)) { throw "Edge wrote no PDF (exit $($p.ExitCode))" }
$bytes = [IO.File]::ReadAllBytes($pdf)
if ([Text.Encoding]::ASCII.GetString($bytes, 0, 5) -ne '%PDF-') { throw 'Output is not a PDF' }
# move $pdf to its destination, then remove $work
```

## NOTES
- Check it the fast way: switch Windows to dark mode (Settings > Personalization > Colors) and print a page that uses the tokens. If the PDF comes out dark, the overrides are not screen-scoped.
- Headless Chrome is the same engine. Browser-automation libraries differ (some emulate a light scheme by default, some inherit the OS), so scoping the CSS to `screen` is the fix that holds for every renderer.
- Minimum width: because headless Edge will not go below 496 px, a phone-width check (375 px) needs device emulation (for example DevTools Protocol `Emulation.setDeviceMetricsOverride`) rather than `--window-size`.
- Page size, margins, running headers and "Page X of Y" belong in the page's own `@page` rules once Edge's header and footer are switched off.
- Related on this shelf: `pending-update-relaunch.md` (a long-running Chromium instance misbehaving until relaunch).
