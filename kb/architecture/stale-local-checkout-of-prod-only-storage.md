---
tech: architecture
tags: [stale-data, prod-only, local-dev-retired, data-provenance, gitignored-checkout]
severity: high
---
# A local checkout that "looks like" prod-only file storage is not prod-only file storage

## PROBLEM
When a system retires local dev and moves to "prod is the only environment" (all
real data lives on a remote host's mounted volume, no local server or synced
copy), a leftover local directory from BEFORE the retirement can still exist on
disk, gitignored, never cleaned up. It has the exact same shape as the real
store -- the same file naming convention, the same JSON structure, plausible
real-looking record names -- so nothing about READING it signals "this is not
the real data." An agent (or a script, or a person) that scans this directory
to validate a new feature, answer "what does the user actually have," or
build a demo will get a confident, well-formed, WRONG answer. The directory's
staleness is invisible unless you specifically check file mtimes or git
tracked-ness -- the data itself gives no signal that it's out of date.

This is a silent-wrong-output trap, not a crash: every read succeeds, every
field parses, the numbers look reasonable. The only way it surfaces is a human
noticing the reported result doesn't match what they see in the live system
(in the case this was caught, a live screenshot showed a field that the local
copy claimed was empty).

## WRONG
```
# "the app is prod-only, local dev retired" is documented in project memory/CLAUDE.md
# but this local directory still exists from before that happened:
$ ls proxy-decks/
acotar-mates-of-night/  goblins-sl/  king-of-tokyo/  ...

# looks like real data, so it gets used directly:
const dirs = readdirSync(PROXY_DECKS_DIR, { withFileTypes: true });
for (const dir of dirs) {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json")));
  // ...validate a new feature against this, report results to the user as fact
}
```
Nothing here throws. `manifest.commander` is `null` for a deck the user actually
assigned a commander to weeks ago on the live server -- because this local copy
predates that edit by two months and was never synced.

## RIGHT
```
# BEFORE trusting a local data directory as ground truth, check its provenance:
$ git check-ignore -v proxy-decks        # is it even tracked?
.gitignore:20:proxy-decks/  proxy-decks   # -> gitignored: NOT part of the deployed system

$ ls -la proxy-decks/some-deck/manifest.json
-rw-r--r-- 1 user 197609 259637 May 19 16:29 manifest.json   # -> ~2 months stale

# A gitignored directory with old mtimes in a system whose CLAUDE.md/memory says
# "prod-only, local dev retired" is leftover cruft, not a live mirror. Get the
# REAL data from where the system actually documents it lives (here: a
# bind-mounted volume on the prod host, confirmed via docker-compose.yml):
#   volumes:
#     - /mnt/data/tcg/proxy-decks:/app/proxy-decks:rw,z
# then read it live (SSH + docker exec against the running container, or an
# authenticated API call) -- never the local directory of the same name.
```

## NOTES
- The tell is provenance, not content: `git check-ignore` / `git ls-files` (tracked
  vs. gitignored) and file mtimes (recent vs. stale) are cheap, fast checks to run
  BEFORE using any local directory to answer a factual question about live system
  state, especially in a "prod is the only environment" architecture.
- Don't wait for the user to catch this from a screenshot. If a project's own docs
  say local dev is retired, treat every local on-disk data directory as suspect by
  default and confirm provenance before quoting its contents as fact -- proactively,
  not reactively.
- Related: `docker-compose.yml`'s `volumes:` block is the authoritative map of
  where a container's persistent state actually lives on the host filesystem;
  check it before assuming a repo-relative path is meaningful data storage rather
  than a dev-only convenience path.
