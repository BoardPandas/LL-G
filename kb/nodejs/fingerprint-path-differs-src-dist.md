---
tech: nodejs
tags: [fingerprint, hash, cache, dist, build, import.meta.dirname]
severity: medium
---
# A content fingerprint that hashes file paths differs between src and dist

## PROBLEM
A freshness fingerprint that hashes each input as `relative(root, file):sha` includes the path. When the same module runs from `src/` in tests and from `dist/` in the generator (data copied to `dist/data`), the relative path differs (`../src/data/x.json` vs `../dist/data/x.json`), so every fingerprint mismatches and everything reads as stale, though no byte changed. Found in tcg's frame progress manifest: all 41 live families failed freshness while 10 drafts (assets outside the build tree) passed.

## WRONG
```ts
const data = join(DATA_DIR, `${id}.json`); // src/data or dist/data
return hashFiles(ASSETS_DIR, [data, ...assetFiles]); // line = relative(ASSETS_DIR, file):sha
```

## RIGHT
```ts
const data = await readFile(join(DATA_DIR, `${id}.json`));
return sha256([`${id}.json:${sha256(data)}`, await hashFiles(ASSETS_DIR, assetFiles)].join("\n"));
```

## NOTES
Name inputs by a build-independent key (file name, logical id) plus content. Run the producer from the built tree and the checker from source at least once before trusting a fingerprint test.
