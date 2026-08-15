---
tech: express
tags: [routing, route-order, path-params, 500, postgres, cast, dead-endpoint, refactor]
severity: high
---
# A literal route registered after its :id sibling is dead, and says 500 instead

## PROBLEM

Express matches routes in **registration order**, not by specificity. A parameterised
route registered first swallows every same-shape request that follows it, so a literal
sibling registered later is unreachable — not 404, but whatever the parameter handler
does with a nonsense parameter.

What makes this expensive is the error you get. `/v1/tickets/stats` was handled as
`/v1/tickets/:id` with `id = 'stats'`, the handler ran `WHERE t.id = $1` against an
integer column, Postgres refused the cast (`22P02 invalid input syntax for type
integer: "stats"`), and the handler's catch-all returned a generic 500. Nothing in the
error mentions routing, the stats handler, or the shadowing route. The endpoint looks
broken; the route table looks fine; the stats SQL is never reached and so never suspected.

Three things keep it hidden:

- **A refactor introduces it silently.** Both registrations existed and worked before a
  "split oversized files" commit reordered them. No route was added or deleted, so the
  diff reads as a pure move and review sees nothing.
- **Sub-paths are fine, which builds false confidence.** `/tickets/:id/followers`,
  `/tickets/:id/merge` etc. all coexist happily with `/tickets/:id` because they have a
  different segment count. Only a *bare literal at the same depth* is shadowed, so a
  glance at the file suggests ordering doesn't matter here.
- **A dead endpoint produces no signal.** If nothing renders it yet — a hook defined but
  never called, a prefetch never wired up — it can 500 in production indefinitely. Ours
  did, for two months.

The same trap applies across routers mounted in sequence: `router.use(crudRouter)` before
`router.use(dashboardRouter)` means crudRouter's `:id` can shadow a literal in the router
mounted after it, if they share a prefix.

Note the sibling failure mode: had the column been text rather than integer, there is no
cast to fail. The `:id` lookup would have matched zero rows and returned a clean **404**,
which reads as "endpoint not deployed" and is even easier to misdiagnose.

## WRONG

```js
// GET /v1/tickets/:id — registered first, so it answers everything
router.get('/v1/tickets/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM tickets WHERE id = $1 AND client_id = $2',
      [req.params.id, clientId]      // id = 'stats' -> Postgres 22P02
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (error) {
    // The cast failure lands here and becomes a generic 500 that names
    // neither the route nor the real problem.
    res.status(500).json({ error: error?.message || 'Failed to get ticket' });
  }
});

// ...180 lines later. Never reached. Every request 500s.
router.get('/v1/tickets/stats', async (req, res) => { /* ... */ });
```

## RIGHT

```js
// Literals first. Express matches in registration order, so the most
// specific path must be registered before the parameterised one.
//
// MUST stay above /tickets/:id — see LL-G express/route-literal-shadowed-by-param-route
router.get('/v1/tickets/stats', async (req, res) => { /* ... */ });

router.get('/v1/tickets/:id', async (req, res) => { /* ... */ });
```

Pin the order with a test rather than a comment alone. Mount the real router under
supertest and assert the literal route reaches its own handler:

```js
it('reaches the stats handler, not the :id handler', async () => {
  // Dispatch on SQL so each handler gets a realistically-shaped row. A single
  // catch-all mock hands the aggregate row to whichever handler runs, and the
  // assertion passes even while :id is answering the request.
  query.mockImplementation(async (sql) =>
    sql.includes('COUNT(*)')
      ? { rows: [{ total: 7, open: 4, closed: 3 }] }
      : { rows: [{ id: 42, subject: 'hello' }] }
  );

  const res = await request(app(router, USER)).get('/v1/tickets/stats');

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ total: 7, open: 4, closed: 3 });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('COUNT(*)');
  expect(params).not.toContain('stats');   // the bug's signature
});
```

## NOTES

**Audit an existing router** — list registrations in order and look for a bare literal
below a same-depth `:param`, per HTTP method:

```bash
grep -n "router\.\(get\|post\|put\|patch\|delete\)" src/routes/tickets.ts
```

Only compare within the same method: a `GET /x/:id` does not shadow a `POST /x/bulk`.
Check routers mounted after this one for the same prefix too.

**Verifying a fix**: run the new test against the *unfixed* file before trusting it. Our
first draft passed 3 of 4 assertions on the broken code, because a generic `db.query`
mock let the `:id` handler return the aggregate row the test was asserting on. A test that
cannot fail is not cover.

**Related**: `express/router-guard-by-mount-not-prefix.md` — the other case where Express
does something order- and mount-dependent that a reading of the route list does not reveal.

**Not Express-specific.** Any first-match router has this: Flask (without strict
url_map ordering), Gin, Chi, Fastify's older versions, and most hand-rolled routers.
Frameworks that rank by specificity instead — Next.js app router, Rails' constraint-aware
matcher — do not, which is why developers moving from those to Express do not expect it.
