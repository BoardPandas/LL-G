---
tech: research
tags: [fandom, mediawiki, scraping, research]
severity: medium
---
# Fandom wiki pages sit behind a bot challenge; the MediaWiki API does not

## PROBLEM
Research agents fetching fandom.com article URLs get a Cloudflare 'Just a moment' interstitial instead of content, and proxy readers are blocked too, so the agent reports the wiki as unavailable. The same wiki's MediaWiki API is not behind the challenge.

## WRONG
```bash
curl https://bobiverse.fandom.com/wiki/Bill   # challenge page, no content
```

## RIGHT
```bash
curl 'https://bobiverse.fandom.com/api.php?action=query&list=allpages&aplimit=500&format=json'
curl 'https://bobiverse.fandom.com/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=Bill&format=json'
```

## NOTES
Wiki prose is CC BY-SA: paraphrase rather than copy it into a project.
