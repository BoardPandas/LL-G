---
tech: web-security
tags: [csp, form-action, redirect, oidc, chrome, post]
severity: high
---
# CSP form-action also blocks the redirect that follows a form POST

## PROBLEM
A page that POSTs a form to its own origin, whose server then answers with a 302 to another
origin (an identity provider hand-back), is blocked in Chrome when that origin is missing from
`form-action`. Chrome applies `form-action` to every hop of the submission's redirect chain.
The user sees nothing happen; the only trace is a console error.

## WRONG
```http
Content-Security-Policy: default-src 'none'; form-action 'self'
```

## RIGHT
```http
Content-Security-Policy: default-src 'none'; form-action 'self' https://login.example.com
```

## NOTES
List every origin the POST response may redirect to. Test the full submit in a real browser;
unit tests of the POST handler see only the 302 and pass.
