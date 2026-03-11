---
name: code-review
description: Run a full code review of the codebase with severity-ranked findings. Use when you want a comprehensive quality check.
user-invocable: true
argument-hint: [optional: file or directory path to scope the review]
allowed-tools:
  - Read
  - Glob
  - Grep
  - Task
---

# Code Review

You have been asked to perform a full code review. Follow these steps.

## Step 1: Determine Scope

1. If the user specified a file or directory, scope the review to that path.
2. If no scope was specified, review the entire codebase.
3. Read `.gitignore` and respect its patterns -- do not review ignored files.
4. Read `CLAUDE.md` to understand the project's coding standards.

## Step 2: Scan Files

Use Glob to find all source files in scope. Group them by type (e.g., TypeScript, Python, Go, Rust, etc.). Read each file.

## Step 3: Review Checklist

For each file, evaluate against these categories:

### Correctness
- Logic errors, off-by-one bugs, race conditions
- Unhandled edge cases (null, empty, negative, overflow)
- Incorrect return types or missing return statements
- Async/await misuse (missing await, unhandled promise rejections)

### Naming and Clarity
- Vague or misleading variable and function names
- Inconsistent naming conventions within the codebase
- Functions doing more than their name suggests

### DRY Violations
- Duplicated logic that should be extracted into a shared function
- Copy-pasted blocks with minor variations

### Error Handling
- Swallowed exceptions (empty catch blocks)
- Generic error messages that lose context
- Missing error handling on I/O operations, network calls, or user input

### Type Safety
- Implicit `any` types (TypeScript)
- Unsafe type assertions or casts
- Missing null checks on nullable values

### Test Coverage
- Public functions or API endpoints with no tests
- Tests that verify implementation details instead of behavior
- Missing edge case tests

### Dead Code
- Unused imports, variables, or functions
- Commented-out code blocks
- Unreachable code after return/throw/break

### TODO/FIXME/HACK
- Outstanding TODO comments that should be resolved or tracked as issues
- HACK comments indicating known shortcuts

### Consistency
- Mixed formatting styles within a file
- Inconsistent patterns across similar files (e.g., some API handlers validate input, others do not)

## Step 4: Produce Report

Format the report as follows:

```
# Code Review Report

## Summary
- Files reviewed: <count>
- Critical: <count>
- Warning: <count>
- Suggestion: <count>

## Critical Findings
[CRITICAL] file:line -- <description>
  Recommendation: <how to fix>

## Warnings
[WARNING] file:line -- <description>
  Recommendation: <how to fix>

## Suggestions
[SUGGESTION] file:line -- <description>
  Recommendation: <how to fix>
```

## Step 5: Offer Fixes

After presenting the report, ask the user:

1. "Would you like me to fix all critical issues now?"
2. "Would you like me to fix all warnings?"
3. "Would you like a fix plan for the full list?"

Act on their response.
