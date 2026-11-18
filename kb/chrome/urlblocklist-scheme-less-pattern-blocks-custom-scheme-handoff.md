---
tech: chrome
tags: [chrome, edge, URLBlocklist, URLAllowlist, enterprise policy, custom scheme, desktop app, sso]
severity: high
---
# A URLBlocklist pattern without a scheme also blocks custom-scheme hand-offs

## PROBLEM
A Chrome or Edge `URLBlocklist` entry with no scheme (`claude.ai`) matches every scheme, not only `https`. A desktop app that finishes sign-in by redirecting the browser to its own custom scheme (`claude://claude.ai/sso-callback`) contains the blocked host, so the hand-off is blocked. Sign-in in the desktop app then fails while the website itself keeps working, and nothing in the policy looks wrong on inspection. Observed on Chrome 157 (2026-11-16).

Scheme-qualified host patterns (`https://host`, `http://host`) block the website without touching the custom scheme. Sign-in paths that must stay open can be allowed explicitly with `URLAllowlist`, which takes precedence over `URLBlocklist` for the URLs it matches.

## WRONG
```json
{
  "URLBlocklist": ["claude.ai", "chatgpt.com", "auth.openai.com"]
}
```

## RIGHT
```json
{
  "URLBlocklist": [
    "https://claude.ai",
    "http://claude.ai",
    "https://chatgpt.com",
    "http://chatgpt.com"
  ],
  "URLAllowlist": [
    "https://claude.ai/sso-callback/desktop-app",
    "https://chatgpt.com/codex/desktop-auth"
  ]
}
```

## NOTES
- Do not block `auth.openai.com`: blocking it breaks ChatGPT and Codex sign-in, because the desktop apps complete authentication there.
- Test sign-in in the desktop app after every policy change. The browser sign-in working is not evidence that the hand-off works.
