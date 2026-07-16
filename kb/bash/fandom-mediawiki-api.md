---
tech: bash
tags: [fandom, wiki, cloudflare, scraping, curl, webfetch, mediawiki-api]
severity: medium
---
# Fandom wikis: scrape via the MediaWiki API, not the HTML (Cloudflare blocks it)

## PROBLEM
Fandom wiki article pages (`*.fandom.com/wiki/<Title>`) sit behind a Cloudflare "Just a moment…" JS challenge. BOTH default WebFetch (returns HTTP 403 / the challenge page) AND `curl` with a browser `User-Agent` fail — the UA trick still hits the JS wall and returns the interstitial, not the article. This blocks research SILENTLY: you get a response that looks fine but contains no article content, so a scraper "succeeds" with empty data. (The repo's own research-theme skill documents the curl-with-UA approach, which does NOT work — don't trust it.)

## WRONG
```bash
# Both of these return the Cloudflare challenge page, not the article:
curl -sL "https://vivapinata.fandom.com/wiki/Roario" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36" \
  -o page.html          # page.html is the "Just a moment…" interstitial
# (and default WebFetch on the same /wiki/ URL -> 403)
```

## RIGHT
```bash
# The MediaWiki API (api.php) is NOT behind the challenge. Fetch raw wikitext.

# One page's wikitext:
curl -sL -G "https://vivapinata.fandom.com/api.php" \
  --data-urlencode "action=parse" \
  --data-urlencode "page=Roario" \
  --data-urlencode "prop=wikitext" \
  --data-urlencode "format=json"

# Bulk — up to ~20-50 titles per call, pipe-separated:
curl -sL -G "https://vivapinata.fandom.com/api.php" \
  --data-urlencode "action=query" \
  --data-urlencode "prop=revisions" \
  --data-urlencode "rvprop=content" \
  --data-urlencode "rvslots=main" \
  --data-urlencode "titles=Roario|Zumbug|Dragonache" \
  --data-urlencode "format=json"

# Enumerate a category (roster / species / member lists):
curl -sL -G "https://vivapinata.fandom.com/api.php" \
  --data-urlencode "action=query" \
  --data-urlencode "list=categorymembers" \
  --data-urlencode "cmtitle=Category:Species" \
  --data-urlencode "cmlimit=500" \
  --data-urlencode "format=json"
```

## NOTES
- Applies to any `*.fandom.com` wiki — just swap the subdomain. `api.php` is standard MediaWiki, so the same pattern works on non-Fandom MediaWiki wikis too.
- You parse wikitext (infobox templates + section markup), not rendered HTML — a little more work, but reliable and structured.
- Running MULTIPLE scrapers in parallel: each must write scratch/HTML files to its OWN session scratchpad, NOT a shared `/tmp/<fixed-name>` path. Parallel agents clobbered a shared `/tmp/vp_wikitext.json` mid-run.
