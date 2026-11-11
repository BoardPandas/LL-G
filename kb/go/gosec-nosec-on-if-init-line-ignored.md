---
tech: go
tags: [gosec, nosec, sast, oneleet, static-analysis, suppression]
severity: high
---
# A trailing #nosec on an if-init line is ignored by older Gosec, so reviewed findings stay open

## PROBLEM
Some hosted code-security scanners (Oneleet's among them) run an older Gosec. That version does not honor a `// #nosec` comment at the end of an `if x, err := call(); err != nil {` line. Go's comment map attaches that comment to the first statement inside the block, not to the call in the init, so the finding still reports. Current Gosec (`go install ...@latest`) matches suppressions by line and honors it, so a local scan shows every hit suppressed while the hosted dashboard keeps them OPEN. Nothing errors. The findings just never close. Seen live: 39 already-reviewed findings stayed open for this reason alone.

The tell is a pair in the same file. A plain statement with a trailing `#nosec` is suppressed, while the `if` line right below it, carrying the same comment, is open.

## WRONG
```go
_ = exec.CommandContext(ctx, "systemctl", "unmask", unit).Run() // #nosec G204 -- validated unit
if out, err := exec.CommandContext(ctx, "systemctl", "enable", unit).CombinedOutput(); err != nil { // #nosec G204 -- validated unit
	return fmt.Errorf("enable: %s", out)
}
```

## RIGHT
```go
out, err := exec.CommandContext(ctx, "systemctl", "enable", unit).CombinedOutput() // #nosec G204 -- validated unit
if err != nil {
	return fmt.Errorf("enable: %s", out)
}
```

## NOTES
- Where `err` already exists in that scope, the split needs `err =`, not `:=`. `go vet` for every GOOS you ship catches the "no new variables" cases.
- Before switching to `err =`, check that the function has no named `err` return and no `defer` that reads `err`. Otherwise the assignment can change what the function returns.
- Hoisting the call out of the `if` widens the scope of `out`, `data` and the like. A later `:=` of the same name then reuses the variable instead of shadowing it, so read each function after the change.
- Gosec v2.19-v2.22 cannot load Go 1.27 packages, so the hosted behavior cannot be reproduced locally. Verify the fix with the proof pair above, then confirm current Gosec with `-track-suppressions` still reports each hit as `inSource`.
