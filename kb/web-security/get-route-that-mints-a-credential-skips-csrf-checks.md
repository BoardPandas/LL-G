---
tech: web-security
tags: [csrf, samesite-lax, get, credential, download, configuration-profile, origin-check, state-changing-get]
severity: high
---
# A GET route that mints a credential skips origin and CSRF checks while the SameSite=Lax cookie rides top-level navigations

## PROBLEM
A download link is the natural way to hand someone a file, so a route such as "download my configuration profile" is written as a `GET`. If producing the file also **mints a credential** (a device password, an API token embedded in the profile), the route changes state on a `GET`:

- CSRF and `Origin` checks are normally applied to unsafe methods only, so the route has neither.
- A `SameSite=Lax` session cookie is sent on top-level cross-site navigations, so any link on any page or in any email that points at the route runs it as the signed-in user.

The result is a credential created without the user asking for one, each time they follow such a link.

## WRONG
```html
<a href="/account/devices/profile?name=phone">Download profile</a>
<!-- GET /account/devices/profile mints a device credential and returns the file -->
```

## RIGHT
```html
<form method="post" action="/account/devices/profile">
  <input type="hidden" name="csrf_token" value="...">
  <input type="hidden" name="name" value="phone">
  <button type="submit">Download profile</button>
</form>
<!-- POST: origin check + CSRF token as a form field; the response is still a file download -->
```

## NOTES
- A native form POST can return a file download just as a link can, so nothing is lost for the user.
- Audit every `GET` route for side effects: minting, sending, revoking, consuming a one-time value.
- Because the route is now reached by a native form post, its refusals must be pages, not raw JSON.
- Related: `samesite-lax-same-host-other-ports.md` on this shelf.
