# LL-G: Lessons Learned & Gotchas

This repo is a machine-readable knowledge base of coding gotchas and lessons learned. It is not a project -- it is a reference Claude loads before scripting to avoid known failure patterns.

## How to Use This KB

**Before writing any script or code:**
1. Read `llms.txt` in this repo root -- it lists all technologies and links to their indexes
2. Load the `llms.txt` for each technology you are about to use
3. Load individual entry files marked HIGH, or any entry whose title matches the specific task

Do not load every entry. Use the two-level index to load only what is relevant.

## Entry File Format

Each entry file uses this structure:

```
---
tech: <technology>
tags: [tag1, tag2]
severity: high|medium|low
---
# Title

## PROBLEM
What goes wrong and why it's not obvious.

## WRONG
<code showing the wrong pattern>

## RIGHT
<code showing the correct pattern>

## NOTES
Edge cases, related entries, cross-references.
```

## Severity Legend

- **HIGH** -- produces silent wrong output or causes hard-to-debug errors. Always load these.
- **MEDIUM** -- causes obvious failures (build errors, test failures). Load when relevant.
- **LOW** -- style/convention issues caught by linters. Skip unless explicitly asked.

## Adding a New Lesson

Run `/add-lesson` from any repo session. The skill collects the details and writes the entry file, updates the tech `llms.txt`, and updates the master `llms.txt` entry count atomically.

To add manually:
1. Create `kb/<tech>/<slug>.md` using the entry format above
2. Append a bullet to `kb/<tech>/llms.txt` under `## Entries`
3. Increment the entry count in the master `llms.txt` for that technology

## KB Location

**GitHub:** `https://github.com/wellforce-brandon/LL-G`
**Raw URL base:** `https://raw.githubusercontent.com/wellforce-brandon/LL-G/main/`

All paths in `llms.txt` and per-tech indexes are relative to the repo root. Consumer repos should use the raw GitHub URLs to fetch entries, not local file paths.

## RULE 3 -- Check BP Before Starting New Work

**When onboarding a repo, starting a new feature, or setting up tooling -- load the BP index and check applicable best practices.**

Step 1: Fetch https://raw.githubusercontent.com/wellforce-brandon/BP/main/llms.txt
Step 2: For each concern relevant to your task, read its llms.txt index
Step 3: Load all FOUNDATIONAL entries (these apply to every repo)
Step 4: Load RECOMMENDED entries whose tech tags match the current project

BP is the complement to LL-G: where LL-G tracks what NOT to do, BP tracks what TO do.
