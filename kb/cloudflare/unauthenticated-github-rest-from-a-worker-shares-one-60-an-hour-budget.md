---
tech: cloudflare
tags: [workers, github, rate-limit, egress-ip, git-smart-http, ls-remote, info-refs]
severity: high
---
# Unauthenticated GitHub REST from a Worker shares one 60-an-hour budget

## PROBLEM
GitHub allows 60 unauthenticated REST API requests an hour per source IP address. A Cloudflare Worker's `fetch` leaves from egress addresses shared with other Cloudflare customers, so that allowance is shared with every other tenant whose Worker calls `api.github.com` without a token from the same address. A Worker making one unauthenticated call an hour (to read a public repo's `main` commit, say) still gets intermittent `403` "API rate limit exceeded" answers it did nothing to earn. It cannot be reproduced locally, where your own IP has its own 60, and it comes and goes with neighbours' traffic.

## WRONG
```ts
const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches/main`, {
  headers: { "User-Agent": "my-worker", Accept: "application/vnd.github+json" },
});
const sha = (await res.json()).commit.sha; // 403 whenever a neighbour has spent the IP's 60
```

## RIGHT
For a public repo's branch head, read git's smart-HTTP ref advertisement, the request `git ls-remote` makes. It is served by git's HTTP endpoint, not the REST API, so the REST limit does not apply:
```ts
const res = await fetch(`https://github.com/${owner}/${repo}.git/info/refs?service=git-upload-pack`, {
  headers: { "User-Agent": "my-worker (+https://example.com)" },
});
// The body is pkt-lines, each prefixed by its length in four hex digits:
//   "001e# service=git-upload-pack\n", "0000" (flush), then "<len><sha> <ref>\n" per ref,
//   with capabilities after a NUL on the first ref line.
// Parse by the length prefixes, require the service line first (so an HTML page served
// with a 200 is refused), and match "refs/heads/main" exactly.
```
For anything else, authenticate (a GitHub App installation token or a fine-grained token): authenticated limits are per token, not per IP.

## NOTES
- Checked: `GET https://api.github.com/repos/<owner>/<public-repo>/branches/main` answers with `x-ratelimit-limit: 60`; the `info/refs` GET carries no rate-limit headers. A `HEAD` to `info/refs` gets 405, so use GET.
- Do not send `Git-Protocol: version=2`: protocol v2 does not advertise refs up front.
- Cap the body size (a repo with many branches and tags advertises them all), and treat a failed read as "unknown", never as "unchanged".
