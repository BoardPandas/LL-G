---
tech: cloudflare
tags: [cloudflare, workers, custom-domain, dns, deploy, smoke-test, enotfound]
severity: medium
---
# New Workers Custom Domain is not resolvable for seconds after deploy

## PROBLEM
The first `wrangler deploy` that declares a route with `custom_domain: true` creates the DNS record and the certificate for that hostname. A smoke request sent immediately afterwards can fail with `ENOTFOUND` (or a TLS error) even though the deploy succeeded and the Worker is live. Observed on 2026-10-13: the name resolved within 5 seconds. A smoke test that fails on its first request reads as a broken deploy and triggers a needless rollback or re-run.

## WRONG
```bash
pnpm exec wrangler deploy
curl -fsS https://mcp.example.com/health   # first request after creation: ENOTFOUND
```

## RIGHT
```bash
# Retry only network and TLS failures, bounded to about 180 seconds
deadline=$((SECONDS + 180))
while :; do
  code=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' https://mcp.example.com/health) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ] && [ "$code" = "200" ]; then break; fi
  case "$rc" in
    6|7|28|35|60) ;;                     # DNS, connect, timeout, TLS: transient, retry
    0) case "$code" in 520|521|522|523|524|525|526|527|530) ;; *) exit 1 ;; esac ;;
    *) exit 1 ;;
  esac
  [ "$SECONDS" -ge "$deadline" ] && exit 1
  sleep 5
done
```

## NOTES
The retry budget is deliberate: a real outage must still fail the job within a few minutes. Never retry 4xx responses, a Worker-generated 5xx, or a response whose JSON body reports an application error, because retrying those hides genuine bugs behind a green smoke test. The lag is a property of the first deploy that creates the custom domain only.
