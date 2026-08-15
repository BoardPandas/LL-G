---
tech: express
tags: [middleware, authorization, static-analysis, route-census, guard, step-up]
severity: high
---
# Choosing a guard from the request body hides it from every static check

## PROBLEM

Express binds middleware at mount time, so a route whose required permission
depends on the request body cannot express that with a middleware argument. The
tempting workaround is to validate the body first and then hand the request to
one of two pre-guarded sub-routers.

It works at runtime, and it is still wrong — because the route as written is
`router.post('/', dispatcher)` with no guard on it. Anything that reads these
files rather than executing them sees an unguarded route: a route census, a
lint rule, an auditor, or the next person skimming for which endpoints are
protected. The guard exists only once control flow reaches it, which means a
later edit can remove it and nothing will look wrong.

The failure mode this creates is the one such checks exist to catch: an
endpoint that *is* protected today and quietly stops being so, with the diff
that did it looking like a refactor.

Worse is the variant that skips the dispatcher entirely and guards on the
weaker permission, then re-checks the stronger one by hand inside the handler.
That reads as equivalent and is not, if the framework attaches anything else to
the guard — step-up/MFA enforcement, denial auditing, rate-limit identity. A
hand-rolled check silently drops all of it.

## WRONG

```ts
// Two guarded chains, one path. Runs correctly; audits as unguarded.
const attendedChain = Router();
attendedChain.post('/', requireCapability('remote.attended'), handler);
const unattendedChain = Router();
unattendedChain.post('/', requireCapability('remote.unattended'), handler);

router.post('/', (req, res, next) => {
  const chain = req.body?.mode === 'unattended' ? unattendedChain : attendedChain;
  chain(req, res, next);              // <- no guard visible on this route
});

// Even worse: one guard, then a manual check that skips whatever else the
// real guard does (step-up, denial records, grant accounting).
router.post('/', requireCapability('remote.attended'), (req, res) => {
  if (req.body.mode === 'unattended' && !actor.has('remote.unattended')) return deny(res);
  // ...destructive work now runs without the second factor that capability demands
});
```

## RIGHT

```ts
// Put the discriminator in the path so each route carries its own static
// guard. Most API contracts permit adjusting route names; few permit
// unverifiable authorization.
router.post('/attended',   requireCapability('remote.attended'),   forceMode('attended'),   handler);
router.post('/unattended', requireCapability('remote.unattended'), forceMode('unattended'), handler);

// The path chose the guard, so the body must not be able to disagree with it.
const forceMode = (mode: Mode) => (req, _res, next) => {
  if (req.body && typeof req.body === 'object') req.body.mode = mode;
  next();
};
```

## NOTES

`forceMode` is not ceremony. Without it, `POST /attended {"mode":"unattended"}`
starts an unattended action having proved only the attended permission — the
same bypass, reintroduced one layer down.

If you cannot move the discriminator into the path, the honest alternative is
to make the guard itself the thing that reads the body, so there is still
exactly one guard on the route and static analysis can see it. What must not
happen is a route whose middleware list is empty.

Worth pairing with a check that enumerates every route and asserts each one
resolves a caller — the value of that check is that it fails on patterns like
this, so do not "fix" a census failure by teaching it to recognise the
dispatcher. It was right.

See also `router-guard-by-mount-not-prefix.md`: a route is guarded by its
mount, never by a comment or a path-prefix array.
