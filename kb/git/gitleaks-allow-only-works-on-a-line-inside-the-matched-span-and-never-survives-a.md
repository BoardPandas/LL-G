---
tech: git
tags: [gitleaks, secret-scanning, false-positive, allowlist, wrangler]
severity: medium
---
# gitleaks:allow only works on a line inside the matched span, and never survives a generated file

## PROBLEM
A `gitleaks:allow` comment suppresses a finding only when it sits on a line inside the match itself, so a marker on the line above does nothing.
Gitleaks checks `finding.Line`, which holds the full lines from where the match starts to where it ends. A reviewer-friendly comment on the line before the flagged code is outside that span, and the finding stays. Multi-line rules make it worse: the `private-key` rule can start at a regex literal that merely validates the PEM header and run lazily down to a later string several lines below that contains the footer text. The marker can go on any line in that span, but nowhere else. Inline markers also disappear when a file is regenerated, for example `worker-configuration.d.ts` from `wrangler types`.

## WRONG
```ts
// gitleaks:allow  -- the line above the match: ignored
const FIXTURE = "<a value the rule matches>";
```

## RIGHT
```ts
// A test fixture, not a credential.
const FIXTURE = "<a value the rule matches>"; // gitleaks:allow
```
For a generated file, add a value-based allowlist in a repo-root `.gitleaks.toml` that keeps the default rules:
```toml
[extend]
useDefault = true

[[allowlists]]
description = "Public Access AUD tags, copied into generated types"
regexTarget = "line"
regexes = ['''ACCESS_AUD_(?:API|UI)["']?\s*:\s*"[0-9a-f]{64}"''']
```

## NOTES
- Gitleaks reads `.gitleaks.toml` from the scanned directory only when no `--config` is passed. A hosted scanner that supplies its own config ignores the file, but it still honours inline markers. Use inline markers wherever you can, and keep the config for generated files.
- Check that the suppressions hide nothing real. Run `gitleaks dir` on the old tree, which should reproduce the scanner's findings, and on the new tree, which should come back clean. Then plant a fake key and confirm it is still flagged.
- `[[allowlists]]` needs gitleaks 8.25 or later; older versions use the single `[allowlist]` table.
