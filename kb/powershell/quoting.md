---
tech: powershell
tags: [quoting, variables, strings, interpolation]
severity: high
---
# Variable quoting in strings

## PROBLEM
PowerShell has two quoting modes with fundamentally different behavior. Single quotes are always literal strings -- variables are never expanded. Double quotes expand variables and expressions. Mixing them up produces silent wrong output with no error.

## WRONG
```powershell
$name = "Alice"
$msg = 'Hello $name'      # outputs: Hello $name  (literal)
$path = 'C:\Users\$name'  # outputs: C:\Users\$name (literal)
```

## RIGHT
```powershell
$name = "Alice"
$msg = "Hello $name"           # outputs: Hello Alice
$path = "C:\Users\$name"       # outputs: C:\Users\Alice

# For expressions or method calls, use $():
$msg = "Count: $($items.Count)"
$msg = "Upper: $($name.ToUpper())"
$msg = "Result: $(2 + 2)"
```

## NOTES
- Use single quotes only when you explicitly want a literal string (e.g., regex patterns, paths with no variables)
- Backtick `` ` `` is the escape character inside double-quoted strings: `` `n `` (newline), `` `t `` (tab), `` `$ `` (literal dollar sign)
- Here-strings use `@"..."@` (expanding) or `@'...'@` (literal) -- same quoting rules apply
