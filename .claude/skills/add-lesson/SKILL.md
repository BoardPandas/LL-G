---
name: add-lesson
description: Add a new gotcha or lesson learned to the LL-G knowledge base
model: haiku
---

You are adding a new entry to the LL-G lessons-learned knowledge base.

**Repository:** `wellforce-brandon/LL-G` on GitHub
**Raw URL base:** `https://raw.githubusercontent.com/wellforce-brandon/LL-G/main/`

## Step 1: Collect information

Ask the user for the following (you may ask all at once):
1. **Technology** -- which folder does this belong in? (powershell, nextjs, tailwind, typescript, better-auth, godot, graph-api, bash, ninjaone, cloudflare, teams-sharepoint, cmd, or a new tech name)
2. **Title** -- short descriptive title (becomes the H1 and the link text in llms.txt)
3. **Problem** -- what goes wrong and why it's not obvious
4. **Wrong pattern** -- code showing the incorrect approach
5. **Right pattern** -- code showing the correct approach
6. **Severity** -- high, medium, or low (see legend below)
7. **Tags** -- comma-separated list of relevant keywords
8. **Notes** (optional) -- edge cases, related entries, cross-references

Severity legend:
- high = silent wrong output or hard-to-debug errors
- medium = obvious failures (build errors, test failures)
- low = style/convention, caught by linter

## Step 2: Generate the slug

Convert the title to a slug: lowercase, spaces and punctuation replaced with hyphens, no leading/trailing hyphens.
Example: "Variable quoting in strings" → `quoting.md`

## Step 3: Fetch current state from GitHub

Use WebFetch to read the current master `llms.txt` and the relevant tech `llms.txt` (if the tech folder exists) so you know the current entry count and can avoid duplicates:
```
WebFetch https://raw.githubusercontent.com/wellforce-brandon/LL-G/main/llms.txt
WebFetch https://raw.githubusercontent.com/wellforce-brandon/LL-G/main/kb/<tech>/llms.txt
```

## Step 4: Create the entry file via GitHub API

Use the `mcp__github__create_or_update_file` tool to create `kb/<tech>/<slug>.md` on the `main` branch of `wellforce-brandon/LL-G`:

Content format:
```
---
tech: <technology>
tags: [tag1, tag2, tag3]
severity: <high|medium|low>
---
# <Title>

## PROBLEM
<problem description>

## WRONG
```<language>
<wrong code example>
```

## RIGHT
```<language>
<right code example>
```

## NOTES
<notes, or omit the section if none>
```

Commit message: `Add <tech> gotcha: <title>`

## Step 5: Update the tech llms.txt

Fetch the current content of `kb/<tech>/llms.txt` via GitHub API (`mcp__github__get_file_contents`), then update it with `mcp__github__create_or_update_file` (include the `sha` for update).

Append a new bullet under `## Entries`:
```
- [<Title>](<slug>.md): <one-line description>. <SEVERITY>.
```

If the tech folder does not exist yet, create `kb/<tech>/llms.txt` with:
```
# <Tech> Gotchas

> Known <tech> patterns that cause silent failures or hard-to-debug errors.

## Entries

- [<Title>](<slug>.md): <one-line description>. <SEVERITY>.
```

Commit message: `Update <tech> index: add <slug>`

## Step 6: Update master llms.txt entry count

Fetch the current `llms.txt` via GitHub API, find the bullet for this technology, and increment the entry count: `(N entries)` → `(N+1 entries)`.

If this is a new technology, add a new section under `## Technologies`:
```
### <Tech>
- [<Tech> index](kb/<tech>/llms.txt): All <tech> gotchas (1 entry)
```

Commit message: `Update master index: <tech> now has N+1 entries`

## Step 7: Check for complementary BP entry

After creating the LL-G entry, consider whether this gotcha implies a best practice. Ask yourself:
- Does the RIGHT pattern represent a reusable practice that other repos should adopt?
- Is this pattern about infrastructure, tooling, or configuration (not app-specific logic)?

If yes, check `C:\Github\BP\llms.txt` (or fetch `https://raw.githubusercontent.com/wellforce-brandon/BP/main/llms.txt`) to see if a complementary best practice already exists. If not, tell the user:

```
This gotcha implies a best practice that isn't in BP yet.
The RIGHT pattern could be captured as: "<suggested title>"
Run `/add-practice` in a BP session to create it, or I can draft it now.
```

If the user agrees, create the complementary BP entry at `C:\Github\BP\practices\<concern>\<slug>.md` following BP's entry format (PATTERN/WHY/EXAMPLE/CHECK/IMPLEMENT). Update BP's concern `llms.txt` and master `llms.txt` entry count.

If the RIGHT pattern is too app-specific or already covered in BP, skip this step silently.

## Step 8: Confirm

Output:
- The GitHub URL of the created entry file
- Confirmation that both index files were updated
- The entry's severity level
