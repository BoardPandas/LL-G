---
tech: git
tags: [blame, changelog, keep-a-changelog, rebuild, content-loss]
severity: high
---
# Rebuilding piled-up changelog sections from git blame drops prose and group labels and misdates entries unless done bottom-up from the earliest line

## PROBLEM
Splitting a changelog heading that holds many versions' entries, by mapping each entry through `git blame` to the package.json version of its commit, silently loses text and misplaces entries in several ways.
- Blame reports the last edit, so a reworded entry lands under a later version.
- Rewriting a region higher in the file shifts blame for the regions below it.
- A record parser that only keeps bullets drops intro prose under a heading. A standalone `**Scripts**` label line between bullets either vanishes or ends up trailing the wrong entry.
- A byte check that skips the dropped lines still passes.

## WRONG
```js
r.version = versionAt(blameSha[r.lines[0]]);   // first line only
if (!isBullet(line) && !cur) continue;          // intro paragraph silently dropped
for (const region of regions) rebuild(region);  // top-down
```

## RIGHT
```js
// git blame -M -w; earliest version among ALL the entry's lines
r.version = r.lines.map((i) => versionAt(blameSha[i])).filter(Boolean).sort(cmp)[0];
// prose stays as the preface of its own heading's version; a standalone **Label** line is a hard error
if (/^\*\*[^*]+\*\*:?\s*$/.test(line)) throw new Error("group label inside region");
// rebuild bottom-up, then re-parse the written output and compare every non-blank line
for (const region of regions.reverse()) rebuild(region);
```

## NOTES
- Build the version-to-date map with `git log --full-history`. See git-log-path-simplification-hides-merge-side: versions bumped on merged side branches otherwise have no date.
- A region may need to run wider than the pile, because entries can belong below the next heading.
- Skip headings that are really several branch merges renumbered at landing. Splitting them would restore version numbers that collide with releases.
