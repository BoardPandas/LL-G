---
tech: salesforce
tags: [experience-cloud, saml, relaystate, starturl, lwr, sso]
severity: high
---
# Experience Cloud SAML sign-in from a login page without startURL lands on the domain's root site

## PROBLEM
When an Experience Cloud login page has no `startURL`, the standard Social Login component's SAML button sends RelayState `/`, so every SAML sign-in lands on whatever site sits at the domain root.
On an Enhanced Domain where one site has no path prefix and others live under `/conf26`, `/events`, etc., people signing in on a prefixed site are sent to the root site after a successful SAML login. Nothing errors. Auth providers (Google, Microsoft) do not show this: their SSO URL carries `community=<site>` and lands on that site's home, so only the SAML button misbehaves. Most "Log in" buttons link to the Login page with no `startURL`, so this is the common path.

## WRONG
```text
Button: comm__namedPage "Login" (no state)
  -> /conf26/login                       (no startURL)
  -> getSamlSsoUrl({startUrl: "", samlId})
  -> .../saml/authn-request.jsp?...&RelayState=%2F
  -> after the assertion: redirect to "/"  = the root site
```

## RIGHT
```js
// Sibling LWC on the site's Login page. The standard socialLogin reads startURL
// from window.location at click time, so fixing the URL before the click is enough.
import { LightningElement } from 'lwc';
import basePath from '@salesforce/community/basePath'; // "/conf26" on LWR

export default class SignInLanding extends LightningElement {
  connectedCallback() {
    const params = new URLSearchParams(window.location.search);
    const current = (params.get('startURL') || '').trim();
    if (current && current !== '/') return;          // keep a real destination
    params.set('startURL', basePath + '/');
    history.replaceState(history.state, '',
      location.pathname + '?' + params + location.hash); // no reload, no Apex
  }
}
```

## NOTES
- You can see what a login button will send without a browser by calling its Apex as the guest: `POST /<site>/webruntime/api/apex/execute` with `{"namespace":"applauncher","classname":"SocialLoginController","method":"getSamlSsoUrl","params":{"startUrl":"","samlId":"<0LE id>"},"cacheable":false}`. An empty `startUrl` returns `RelayState=%2F`. `"/conf26/"` returns `%2Fconf26%2F`.
- The socialLogin component has no `startUrl` property, so you cannot set it in Builder.
- Don't run `sf community publish` for several sites at once. Concurrent publishes failed with a generic "Something went wrong". Publish one site at a time and wait for each to finish.
- Related: salesforce/experience-cloud-saml-entity-id (per-site ACS).
