---
tech: research
tags: [keep-a-changelog, changelog, spec-version, source-verification]
severity: high
---
# keepachangelog.com's home page still links 1.1.0 and the repo's tags stop at v1.1.2, but Keep a Changelog 2.0.0 is current

## PROBLEM
Checking keepachangelog.com's home page or the GitHub tags of olivierlacan/keep-a-changelog reports 1.1.x as the latest version, but 2.0.0 (2026-06-07) is released and live at /en/2.0.0/.
The home page's "Continue" link and the GitHub tags (last v1.1.2, last Release v1.1.1) were never updated, so an agent that answers "what does Keep a Changelog recommend" from either one quotes 1.1.0. That version has no guidance on large changelogs, while 2.0.0 does.

## WRONG
```bash
curl -s https://keepachangelog.com/ | grep -o '/en/[0-9.]*/'      # /en/1.1.0/
gh api repos/olivierlacan/keep-a-changelog/tags --jq '.[0].name'  # v1.1.2
```

## RIGHT
```bash
gh api repos/olivierlacan/keep-a-changelog/contents/CHANGELOG.md -H 'Accept: application/vnd.github.raw' | grep -m3 '^## \['
gh api 'repos/olivierlacan/keep-a-changelog/contents/source/en?ref=main' --jq '.[].name'   # ... 2.0.0
curl -s -o /dev/null -w '%{http_code}\n' https://keepachangelog.com/en/2.0.0/              # 200
```

## NOTES
2.0.0 keeps the 1.1.0 format: the six types, `YYYY-MM-DD` dates, and the `[Unreleased]` and `[YANKED]` markers are unchanged. It adds guidance:
- Pin the format link to the version you follow.
- A long single file is usually fine. If you archive, link the main file and the archive both ways, archive only versions old enough not to need editing, and never delete old entries.
- Use compare links per version.
- Mark breaking changes with `**Breaking:**`.
- State your version scheme when it is not SemVer.
- Do not make a changelog edit a required check on every change.

General rule: for any spec, read the project's own changelog or versioned docs folder. A landing page or the tags list can lag behind.
