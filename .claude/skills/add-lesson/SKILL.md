---
name: add-lesson
description: Add a new gotcha or lesson learned to the LL-G knowledge base
model: haiku
---

You are adding a new entry to the LL-G lessons-learned knowledge base at `C:\Github\LL-G`.

## Step 1: Collect information

Ask the user for the following (you may ask all at once):
1. **Technology** -- which folder does this belong in? (powershell, nextjs, tailwind, typescript, or a new tech name)
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

## Step 3: Create the entry file

Create `C:\Github\LL-G\kb\<tech>\<slug>.md` with this exact format:

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

## Step 4: Update the tech llms.txt

Append a new bullet to `C:\Github\LL-G\kb\<tech>\llms.txt` under `## Entries`:

```
- [<Title>](<slug>.md): <one-line description>. <SEVERITY>.
```

If the tech folder does not exist yet, create it:
1. Create `C:\Github\LL-G\kb\<tech>\llms.txt` with:
```
# <Tech> Gotchas

> Known <tech> patterns that cause silent failures or hard-to-debug errors.

## Entries

- [<Title>](<slug>.md): <one-line description>. <SEVERITY>.
```

2. Add the new tech to the master `llms.txt` under `## Technologies`:
```
### <Tech>
- [<Tech> index](kb/<tech>/llms.txt): All <tech> gotchas (1 entry)
```

## Step 5: Update master llms.txt entry count

Read `C:\Github\LL-G\llms.txt`. Find the bullet for this technology and increment the entry count in parentheses: `(N entries)` → `(N+1 entries)`.

If this is a new technology (Step 4 path), the entry was already added in Step 4 -- no increment needed.

## Step 6: Confirm

Output the path of the created entry file and confirm both index files were updated.
