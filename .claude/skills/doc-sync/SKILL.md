---
name: doc-sync
description: Synchronize documentation with the current codebase. Finds stale docs, missing docs, and inconsistencies. Use after making significant code changes.
user-invocable: true
argument-hint: (no arguments needed)
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Task
---

# Documentation Sync

You have been asked to synchronize documentation with the current codebase. Follow these steps.

## Step 1: Inventory Documentation

1. Use Glob to find all documentation files: `**/*.md`, `**/docs/**`, `**/README*`.
2. Read each documentation file.
3. Categorize them:
   - **API docs:** Describe endpoints, functions, or interfaces
   - **Setup docs:** Installation, configuration, environment setup
   - **Architecture docs:** System design, data flow, component relationships
   - **User docs:** How-to guides, tutorials, usage examples
   - **Changelog/release notes**

## Step 2: Inventory Code

1. Identify all public API surfaces:
   - Exported functions and classes
   - API endpoints (routes, handlers)
   - CLI commands and flags
   - Configuration options
2. Identify key files:
   - Entry points (main, index, app)
   - Configuration files
   - Build scripts

## Step 3: Cross-Reference

For each documentation file, check:

1. **Stale references:** Does the doc mention functions, files, or endpoints that no longer exist? Search the codebase for each reference.
2. **Incorrect examples:** Do code examples in the docs match the current API signatures and behavior?
3. **Missing documentation:** Are there public APIs, endpoints, or configuration options that have no documentation?
4. **Version references:** Are version numbers or dependency versions current?
5. **File path references:** Do referenced file paths still exist?
6. **Broken links:** Do internal markdown links point to files that exist?

## Step 4: Generate Changes

For each issue found:

1. **Stale references:** Update or remove the reference. If the functionality was replaced, point to the replacement.
2. **Incorrect examples:** Update the example to match the current code.
3. **Missing documentation:** Draft documentation following the project's existing doc style. Place it in the most appropriate existing doc file.
4. **Version references:** Update to current versions.
5. **Broken links:** Fix or remove the link.

## Step 5: Report

```
# Documentation Sync Report

## Summary
- Documentation files scanned: <count>
- Issues found: <count>
- Files updated: <count>

## Changes Made
[FIXED] <file> -- <description of change>

## Missing Documentation
[NEEDS DOCS] <function/endpoint/config> -- no documentation found

## Recommendations
1. <prioritized suggestions>
```
