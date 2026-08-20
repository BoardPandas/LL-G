---
tech: supportforge
tags: [rmm, release-gates, routing, audit, naming, silent-failure]
severity: high
---
# A route module's `rmm-<nnn>-*` id is what the release gates read as "this package shipped"

## PROBLEM

`scripts/rmm-gates/delivery.js` decides which RMM packages are delivered by
**parsing the module ids registered in `src/routes/rmm.ts`**. There is no ledger
and no manifest -- the file's own header explains why: a hand-kept list of what
shipped is the first thing to go stale, so delivery is derived from the one
place a package must touch to be reachable at all. The number in
`rmm-<nnn>-<surface>` *is* the evidence.

That makes a route id a product claim rather than a label, and a plausible name
can assert something false. Registering session-recording routes as
`rmm-034a-agent-recordings` made GATE-04.5 report the **native remote-desktop
transport as delivered** -- a transport that has never passed its DEC-05 lab
gate and through which no session has ever been established.

The gate does catch it, but only because a separate harness rule refuses a
criterion that is asserted as partial while the catalog now resolves it as
fully verifiable:

```
GATE-04.5 is fully verifiable — use verifies(), not verifiesPartially()
```

That error names a test-harness rule, not a naming mistake, so the obvious
reading is "the gate is out of date, relax the assertion" -- which would bake
the false claim in permanently.

A second obligation rides along with the number. GATE-04.6 asserts that **every**
`rmm-027-*` module's source matches `auditedRmmWrite|withPrivilegedAudit`, so
adopting an `rmm-027-*` id commits the module to writing state inside an audited
transaction.

## WRONG

```ts
// The routes are for RMM-034A's recording feature, so...
registry.register({
  id: 'rmm-034a-agent-recordings',   // <-- now claims RMM-034A shipped
  mountPath: '/agent/remote-sessions',
  router: rmmAgentRecordingsRouter,
});
```

```ts
// And an rmm-027-* module that writes rows without an audited wrapper:
const claim = await claimRecordingSegment(db, { ... });   // GATE-04.6 fails
```

## RIGHT

```ts
// Number it for the package whose *governance* it belongs to. Recording is
// governed-session machinery: the policy is RMM-027's, the guard is RMM-027's
// device identity, and it mounts alongside RMM-027's own routes. When RMM-034A
// passes its gate, that is the moment to register something claiming it --
// deliberately.
registry.register({
  id: 'rmm-027-agent-recordings',
  mountPath: '/agent/remote-sessions',
  router: rmmAgentRecordingsRouter,
});
```

```ts
// An rmm-027-* module that writes state does it inside an audited transaction.
// withPrivilegedAudit directly, not auditedRmmWrite: this caller authenticated
// with a device certificate, and auditedRmmWrite resolves the actor with
// requireRmmActor, which throws for anything that is not a signed-in person.
const claimed = await withPrivilegedAudit(
  db,
  {
    actor: { type: 'agent', id: identity.deviceId, email: null, role: null },
    mspId: identity.mspId,
    subject: { capability: 'rmm.remote.attended', action: '...', /* ... */ },
  },
  (tx) => claimRecordingSegment(tx, { ... }),
);
```

Before registering a new module, read what the number already claims:

```bash
grep -n "id: 'rmm-" src/routes/rmm.ts
npx jest src/__tests__/gates/          # the gates are the check, run them
```

## NOTES

- The same file carries a `SURFACELESS_PACKAGES` exception list for packages
  that legitimately register no route. Its header calls it "intentionally
  hostile to growth" -- an entry there is a package claiming delivery with no
  reachable surface. Do not reach for it to make a gate go green.
- Two failure directions, and only one is loud. Naming a module for a package
  that has *not* shipped over-reports and fails the gate. Naming it for one that
  has already shipped under-reports and fails nothing at all, because the
  package was already counted.
- General form, beyond this repo: when a release gate derives its evidence from
  code rather than from a document, the naming convention it reads becomes
  load-bearing. Renaming a module is then a release decision.
