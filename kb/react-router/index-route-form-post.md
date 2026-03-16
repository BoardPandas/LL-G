---
tech: react-router
tags: [v7, form, action, index, POST, 405, SSR, cloudflare]
severity: high
---
# Form POST on index route hits root route instead of index action

## PROBLEM
In React Router 7 with SSR, a `<form method="post">` on an index route (path `/`) without an explicit `action` attribute sends the POST to the root layout route, not the index route. The root route has no `action` export, so React Router returns `405 Method Not Allowed` with the error: "You made a POST request to '/' but did not provide an action for route 'root'."

This only happens with SSR (Cloudflare Workers, Node server). In SPA mode, client-side routing handles it correctly.

## WRONG
```tsx
// routes/_index.tsx -- index route at "/"
export async function action({ request }) {
  const formData = await request.formData();
  // ... handle form
}

export default function Index() {
  return (
    <form method="post">  {/* POST goes to root, not index! */}
      <input name="url" />
      <button type="submit">Submit</button>
    </form>
  );
}
```

## RIGHT
```tsx
export default function Index() {
  return (
    <form method="post" action="/?index">  {/* Explicitly target index route */}
      <input name="url" />
      <button type="submit">Submit</button>
    </form>
  );
}
```

## NOTES
- The `?index` query parameter is React Router's convention for disambiguating between a layout route and its index route at the same URL path.
- This affects any index route where the parent layout route exists at the same path.
- Alternative: use `<Form action="/?index">` from `react-router` (capital-F Form) which also works.
- This is documented in React Router but easy to miss: https://reactrouter.com/how-to/index-query-param
- Same issue applies to `fetcher.submit()` and `useFetcher` -- use `action: "/?index"` in the submit options.
