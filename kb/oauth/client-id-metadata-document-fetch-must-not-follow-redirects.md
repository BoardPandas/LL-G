---
tech: oauth
tags: [authorization-server, client-id-metadata-document, cimd, http-redirect, ssrf, http-client]
severity: medium
---
# The Client ID Metadata Document draft forbids following HTTP redirects when fetching the document

## PROBLEM
With Client ID Metadata Documents the `client_id` is an HTTPS URL and the authorization server fetches the client's metadata from it. Most HTTP clients follow redirects by default. The draft forbids that for this fetch: the document must come from the `client_id` URL itself. A server that follows a `3xx` accepts metadata served from somewhere other than the URL it will show and store as the client's identity, and lets the fetch be steered to a second address that its URL validation never saw.

Nothing fails when it is wrong: well-behaved clients do not redirect, so tests with them pass.

## WRONG
```text
http = HttpClient()                       # default: follows redirects
doc  = http.get(client_id_url).json()     # may have come from a different URL
```

## RIGHT
```text
http = HttpClient(follow_redirects = false)
resp = http.get(client_id_url)
if 300 <= resp.status < 400:  refuse      # every 3xx is a refusal, not a hop
if resp.status != 200:        refuse
doc = parse(resp.body)
```

## NOTES
- Refuse every 3xx; do not special-case "same host" redirects.
- Add a test server that answers `302` and assert that the registration is refused and that no second request is made.
- The fetch is a server-side request to a caller-chosen URL, so it also needs an address filter, size and time caps; see `kb/rust/hyper-util-httpconnector-skips-custom-resolver-for-ip-literals.md`.
