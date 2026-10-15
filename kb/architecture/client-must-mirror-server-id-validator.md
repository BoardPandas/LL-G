---
tech: architecture
tags: [validation, client-server, identifiers, fail-open, hooks, silent-failure]
severity: high
---
# A client that derives an id the server's validator refuses fails every request for that input, silently

## PROBLEM
A CLI built a repo id from `git remote get-url origin` (strip scheme and `.git`, lowercase) and sent it to a server whose zod schema accepts only `org/repo`, `host.with.dot/org/repo` or `local:<dir>`. Some remotes normalise to a value the server refuses: a dotless ssh alias (`gitea:org/repo`), `github.com:22/org/repo`, or a bare relative path. Every request from such a repo then fails with a 400. The hook fails open and is quiet on most events, so the person sees nothing and coordination stops working for that repo only. Tests on the usual GitHub remotes all pass.

## WRONG
```bash
id="$(normalise "$url")"     # whatever comes out is sent
post "{\"repo\": \"$id\"}"
```

## RIGHT
```bash
# Mirror the server's rules in the client and fall back to a form the server always accepts.
id="$(normalise "$url")"
if ! repo_id_ok "$id"; then      # same regexes, length cap and exclusions as the server's RepoId
  log "repo id not normalisable, sent as local:$(basename "$root")"
  id="local:$(basename "$root")"
fi
```

## NOTES
Put a comment beside the client copy that names the server file, so a change to one prompts a change to the other. Test the refused forms explicitly. Server-side alternatives: accept and normalise, or return the reason in a body that the client surfaces on the events that do print. Found in Roundtable C6 review (2026-10-15).
