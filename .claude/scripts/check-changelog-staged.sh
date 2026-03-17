#!/usr/bin/env bash
# Pre-commit hook: verify CHANGELOG.md is in staged changes
# Exit 0 = pass, Exit 2 = block with message

staged=$(git diff --cached --name-only 2>/dev/null)

if echo "$staged" | grep -q "^CHANGELOG.md$"; then
  exit 0
else
  echo "BLOCKED: CHANGELOG.md is not staged. Update the changelog and version before committing."
  exit 2
fi
