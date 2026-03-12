---
tech: powershell
tags: [strings, special-characters, redirection, parsing, greater-than, parentheses]
severity: high
---
# > is redirection and some parentheses misparse in strings

## PROBLEM
Two parsing gotchas in PowerShell strings:
1. `>` is the output redirection operator. Even inside a double-quoted string passed to a cmdlet, PowerShell parses `>` as redirection before evaluating the string.
2. Parentheses with spaces around words inside double-quoted strings can be misinterpreted as subexpressions in some contexts.

## WRONG
```powershell
# BAD -- parser sees > as redirection, throws "stream already redirected"
Write-Host "Go to Entra admin center > Users > Auth methods"
Write-Status "Check: Portal > Enterprise Apps > $appId > Permissions"

# BAD -- parser chokes on parenthesized phrases
Write-Status "Max lifetime: 480 min (8 hours)"
Write-Status "Single-use: No (reusable within lifetime)"
```

## RIGHT
```powershell
# GOOD -- use -> instead of > for navigation paths
Write-Host "Go to Entra admin center -> Users -> Auth methods"
Write-Status "Check: Portal -> Enterprise Apps -> $appId -> Permissions"

# GOOD -- use dashes or backtick-escape parentheses
Write-Status "Max lifetime: 480 min - 8 hours"
Write-Status "Single-use: No - reusable within lifetime"

# ALSO OK -- backtick-escape
Write-Status "Max lifetime: 480 min ``(8 hours``)"
```

## NOTES
- This behavior is specific to how PowerShell tokenizes strings before passing to cmdlets. It does not occur in all contexts.
- The `>` issue is most common in `Write-Host`, `Write-Warning`, and custom `Write-Status` calls used for UI output.
- In here-strings (`@"..."@`), `>` is literal and safe. Use here-strings for multi-line messages that contain special characters.
