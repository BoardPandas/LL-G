---
tech: bash
tags: [windows, git-bash, path, hooks]
severity: medium
---
# Git Bash on Windows: PATH and tool availability

## PROBLEM
Git Bash on Windows doesn't always have `/usr/bin` on PATH. Common Unix tools (`grep`, `head`, `wc`, `date`) may not be found, especially in hooks and automated scripts where the environment is minimal. `/tmp` exists but maps to a Windows temp directory.

## WRONG
```bash
# Assumes all Unix tools are on PATH
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
LINE_COUNT=$(wc -l < "$FILE")
# "command not found" in hooks or minimal environments
```

## RIGHT
```bash
# Set PATH explicitly at the top of every script/hook
export PATH="/usr/bin:/bin:/c/Users/$USERNAME/bin:$HOME/bin:$PATH"

# Or use full paths for critical utilities
TIMESTAMP=$(/usr/bin/date -u +"%Y-%m-%dT%H:%M:%SZ")
LINE_COUNT=$(/usr/bin/wc -l < "$FILE" | /usr/bin/tr -d ' ')
```

## NOTES
- `/tmp` in Git Bash maps to a real Windows temp directory -- safe for sentinel files and temp scripts
- Forward slashes work for most tools, but some Windows-native tools expect backslashes
- When calling PowerShell from bash, use forward slashes in paths: `powershell.exe -Command "Get-Content 'C:/path/to/file'"`
- `$HOME` in Git Bash is typically `/c/Users/<username>`
