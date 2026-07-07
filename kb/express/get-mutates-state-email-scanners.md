---
tech: express
tags: [http, get, idempotency, email, csat, safe-links, mimecast, proofpoint, url-scanner, side-effects, tokenized-link]
severity: high
---
# GET that mutates state records bogus actions from email link scanners

## PROBLEM
Any HTTP GET reached from a link in an email must be side-effect free. Email
security systems prefetch every URL in an inbound message to scan it for malware
BEFORE (or as) the recipient sees it: Microsoft Defender for Office 365 Safe
Links, Mimecast, Proofpoint URL Defense, plus various AV/proxy scanners. Each
prefetch fires the GET.

If the GET records or mutates state, the scanner registers real actions the
instant the email is delivered, not when a human acts. Classic case: a CSAT/NPS
survey email with per-rating links like `/csat/<token>?score=5` where the GET
handler saved the score. The scanner walks all five score links and poisons the
data.

Tell-tale symptoms:
- A burst of "responses" within seconds of the email being sent (often
  timestamped in the same second as send).
- All distinct values recorded for one entity (all five star scores 1..5 hit in
  the same millisecond) — physically impossible for a human.
- The "winning" saved value is just whichever link the scanner fetched last.

To detect already-poisoned rows: the audit log shows multiple distinct values
recorded for one entity within a few seconds (`count(distinct value) > 1` over a
tiny time span). Do NOT use a naive time-window filter alone — a genuine fast
click can land within 30-60s of send; the multiple-distinct-values signature is
the reliable discriminator.

## WRONG
```ts
// GET commits the rating — a link scanner prefetching the URL records it.
router.get('/v1/public/csat/:token', async (req, res) => {
  const score = Number(req.query.score);
  if (score) await recordCsatResponse(req.params.token, score); // side effect on GET!
  res.type('html').send(renderPage({ recorded: !!score, score }));
});
```

## RIGHT
```ts
// GET is safe: only pre-select + render. Commit on POST behind an explicit
// user action (Submit button) — scanners follow GET links but do not submit forms.
router.get('/v1/public/csat/:token', (req, res) => {
  const n = Number(req.query.score);
  const score = Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined;
  res.type('html').send(renderPage({ score })); // no DB write
});

router.post('/v1/public/csat/:token', urlencoded({ extended: false }), async (req, res) => {
  const result = await recordCsatResponse(req.params.token, Number(req.body.score), req.body.comment);
  res.type('html').send(result.ok ? renderConfirmation() : renderPage({ error: '...' }));
});
```

## NOTES
- Applies to any tokenized one-click email flow: unsubscribe-that-deletes,
  approve/reject links, "confirm" links, magic actions. Reads (safe rendering)
  are fine on GET; writes are not.
- Tradeoff: it is no longer literally one click — the user lands on a page and
  presses Submit. That extra gesture is exactly what a scanner will not perform,
  and is the price of trustworthy data.
- Real example: SupportForge CSAT endpoint `src/routes/csat.ts`, fixed
  2026-07-07 (v2.162.3.0). Six surveys were poisoned (all five score links hit)
  and reset to null via the multiple-distinct-scores audit signature.
- General HTTP principle (RFC 9110): GET/HEAD are safe + idempotent. This is
  not Express-specific — the same trap exists in any framework/language.
