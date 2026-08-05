---
tech: bash
tags: [curl, cloudflare, mediawiki, wiki, fandom, bulbapedia, scraping, web-fetch, silent-failure, jq, research]
severity: high
---
# A Cloudflare challenge answers HTTP 200 with a body, so a blocked wiki scrape yields an empty digest instead of an error

## PROBLEM

`kb/bash/fandom-mediawiki-api.md` records that Fandom article HTML sits behind a Cloudflare JS challenge while `api.php` does not, and prescribes the API as the way through. That is correct **for Fandom** and is routinely over-generalized into "MediaWiki `api.php` is never challenged." It is not a property of MediaWiki — it is a per-site WAF configuration.

**Bulbapedia (`bulbapedia.bulbagarden.net`) challenges `/w/api.php` itself.** Every documented escape hatch fails together: `WebFetch`, plain `curl`, and `curl` with a browser User-Agent all receive the interstitial.

The reason this costs real time is that **it does not look like a failure**:

- HTTP status is **200**, not 403 — so `curl -f`, `set -e`, and any `if [ $? -ne 0 ]` guard all pass.
- A file **is** written, ~6 KB of it — so an existence or non-empty check passes.
- The body is `<!DOCTYPE html><html><head><title>Just a moment...</title>` — valid HTML, zero article content.

So a naive `jq` either dies with `parse error: Invalid numeric literal at line 1, column 10` (which reads like malformed JSON from the server, not a block), or — far worse — a tolerant pipeline with `// empty`, `2>/dev/null`, or a tag-stripping regex returns the **empty string** and the caller records "this page has no content." A research pass over 90 pages then produces a confidently empty dossier section rather than an error, and the wrong conclusion is the one that gets written down.

The same shape catches the two other MediaWiki non-errors that are also HTTP 200: a wrong title returns `{"error":{"code":"missingtitle"}}`, and a redirect returns a ~5-word body starting `#REDIRECT`.

## WRONG

```bash
# Assumes the Fandom rule ("HTML is blocked, api.php is not") holds for every wiki.
curl -sL "https://bulbapedia.bulbagarden.net/w/api.php?action=parse&page=Brock&prop=wikitext&format=json" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" \
  -o page.json

# Exit 0. File exists. 5910 bytes. Every ordinary guard says this worked.
jq -r '.parse.wikitext["*"] // empty' page.json > article.txt
# article.txt is EMPTY, and nothing anywhere reported a problem.

# The tolerant variants are the dangerous ones -- they turn a block into "no content":
text=$(jq -r '.parse.wikitext["*"]' page.json 2>/dev/null)
[ -z "$text" ] && echo "page has no wikitext, skipping"   # <-- WRONG CONCLUSION, recorded as fact
```

## RIGHT

```bash
# Assert on the BODY SHAPE, never on the exit code or the file's existence.
fetch_wikitext() {
  local url="$1" out="$2"
  curl -sL "$url" \
    -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" \
    -o "$out"

  # 1. A WAF challenge is HTML. JSON never starts with a doctype or a tag.
  if head -c 64 "$out" | grep -qiE '<!doctype|<html'; then
    echo "BLOCKED (WAF interstitial, HTTP 200): $url" >&2
    return 1
  fi
  # 2. missingtitle / invalid params are also HTTP 200.
  if jq -e 'has("error")' "$out" >/dev/null 2>&1; then
    echo "API error: $(jq -r '.error.code' "$out") for $url" >&2
    return 1
  fi
  # 3. A redirect stub is a valid 200 with a ~5-word body. Require real length,
  #    and use jq -e so "absent" is a failure rather than the string "null".
  jq -er '.parse.wikitext["*"] | select(length > 200)' "$out" 2>/dev/null || {
    echo "Body too short to be an article ($(wc -c <"$out") bytes): $url" >&2
    return 1
  }
}

# Bulbapedia IS challenged on api.php. Fall back to a different host, not a different path.
fetch_wikitext "https://pokemon.fandom.com/api.php?action=parse&page=Brock&prop=wikitext&format=json&redirects=1" brock.json

# And prove the detector fires before trusting a clean run over N pages:
fetch_wikitext "https://bulbapedia.bulbagarden.net/w/api.php?action=parse&page=Brock&prop=wikitext&format=json" x.json \
  && echo "DETECTOR BROKEN -- this host is known-blocked and should have failed" >&2
```

## NOTES

- **Narrows, does not replace, [`fandom-mediawiki-api.md`](fandom-mediawiki-api.md).** That entry stays true for `*.fandom.com`. What is false is the generalization to all MediaWiki hosts. Treat "is `api.php` reachable?" as a per-host question to probe once, not a property to assume.
- **Working fallbacks**, in the order worth trying: a Fandom mirror of the same franchise (`<franchise>.fandom.com/api.php` — worked for 94 of 95 pages where Bulbapedia served 0); the Wikipedia API (`en.wikipedia.org/w/api.php`, which additionally supports `prop=extracts&explaintext=1` — a Wikipedia extension **not** installed on Fandom, where it returns `Unrecognized value for parameter "prop"`); or a purpose-built structured API where one exists, which beats scraping outright (PokéAPI supplied every species/type/move/item fact with no HTML in the loop).
- **The generalizable rule:** any check whose success condition is "no error and some bytes" cannot distinguish *blocked* from *genuinely empty*. This is the same failure family as the existing `in-place-edit-no-match-silent-noop.md` (a no-op edit exits 0) and `comm-silent-empty-output-git-bash.md` (a broken checker passes every should-be-zero assertion). The fix is the same in all three: assert a **positive** invariant, and confirm the detector fires against a known-bad input before trusting it at scale.
- The interstitial's `<title>Just a moment...</title>` and a body in the 5–7 KB range are the reliable signature. Do not match on byte size alone — it changes.
