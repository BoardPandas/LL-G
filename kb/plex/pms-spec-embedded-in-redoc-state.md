---
tech: plex
tags: [plex, openapi, redoc, scraping]
severity: low
---
# developer.plex.tv/pms has no spec download: extract it from __redoc_state

## PROBLEM
The Plex docs page offers no openapi.json link. The spec is the `spec.data` object inside the page's `__redoc_state` JSON. Dumping that object with `indent=2, ensure_ascii=False` reproduces the openapi.json the page's Download button produces byte for byte (verified by SHA-256). Also, `info.version` is `"1.2.3\n"` with a trailing newline, which breaks any string you format it into.

## WRONG
```bash
# Guessing a spec URL
curl -f https://developer.plex.tv/pms/openapi.json   # there is no such file
```

## RIGHT
```bash
curl -sSL https://developer.plex.tv/pms/ -o pms.html
python3 -c "import json; h=open('pms.html',encoding='utf-8').read(); i=h.index('__redoc_state'); s,_=json.JSONDecoder().raw_decode(h,h.index('{',i)); json.dump(s['spec']['data'],open('plex-pms-api.openapi.json','w',encoding='utf-8'),indent=2,ensure_ascii=False)"
# and strip info.version before using it: spec['info']['version'].strip()
```

## NOTES
The page is about 5 MB; the spec is 1.34 MB.
