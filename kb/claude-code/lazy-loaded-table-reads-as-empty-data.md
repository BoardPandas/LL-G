---
tech: claude-code
tags: [browser-automation, page-text, lazy-loading, spa, false-negative, verification]
severity: high
---
# A lazy-loaded table reads as genuine empty data, not as a loading state

## PROBLEM
Text extraction from a single-page app returns whatever the DOM holds at that instant. When a panel renders its chrome and empty states immediately but fills tables from a later XHR, a read that lands in between is not visibly truncated: the page looks complete, every heading and label is present, and one section reports zero rows. There is no spinner in the text, no error, and no marker distinguishing "this table is empty" from "this table has not arrived yet".

The failure is asymmetric and that is what makes it dangerous. A claim resting on rows that ARE present is safe, because content cannot appear from nowhere. A claim resting on rows being ABSENT is unfalsifiable from the same read, and it inverts the finding -- you report the opposite of the truth with full confidence.

Measured on Rocket.net's wpsitecontrol panel: `get_page_text` on the Backups tab returned the "Cloud Backups | 0 / No cloud backups yet" empty state fully rendered, alongside the Automated Backups table as column headers with zero rows. Both sites were in fact backing up daily (12 and 14 retained snapshots). The rendered zero on the adjacent section is what sells it -- a real count next to the empty table reads as corroboration. The wrong conclusion ("neither site has any backup, nothing to restore from") was drafted as the lead item of a client email twice, across two separate sessions five days apart, because the same read fails the same way every time.

Waiting longer is not the fix. The second read used an 8-second wait and still returned headers-only on first attempt; the tables arrive on their own schedule and sometimes after a second navigation.

## WRONG
```js
// Read the page, then conclude from the absence of rows.
await navigate({ url: `${panel}/sites/${id}/backups` });
await wait({ duration: 4 });
const text = await get_page_text({ tabId });

// "Automated Backups" heading present, no rows beneath it.
if (!/Platform Backup/.test(text)) {
  report("This site has no automated backups. Escalate to the vendor today.");
}
// Page looked complete. Adjacent section showed a real count of 0.
// Both sites were backing up daily the whole time.
```

## RIGHT
```js
// A negative needs positive evidence that the table finished loading.
// Prefer the rendered count badge, which arrives WITH the data it counts.
await navigate({ url: `${panel}/sites/${id}/backups` });
await wait({ duration: 6 });

const text = await get_page_text({ tabId });
const badge = text.match(/Automated Backups\s*\|?\s*(\d+)/);

if (!badge) {
  // No count rendered: the section is still loading. This read proves nothing.
  // Re-read, or confirm visually, before asserting anything either way.
  await computer({ action: "screenshot", tabId });
  report("Backup state unconfirmed -- table had not rendered.");
} else if (Number(badge[1]) === 0) {
  report("No automated backups (count badge rendered as 0).");
} else {
  report(`${badge[1]} automated backups present.`);
}
```

## NOTES
Rules that generalise beyond this one panel:

- **Absence of rows is never proof of absence of data.** Treat every negative finding drawn from extracted page text as unproven until something that ships with the data confirms it: a count badge, a paginator ("1 - 10 of 14"), or an explicit designed empty state ("No data yet. Add a user...").
- **An empty state is only evidence when it is the designed one.** `No cloud backups yet` plus a `Create` button is a real answer. Column headers with nothing under them is not.
- **Screenshot before reporting a negative to anyone.** An image cannot show a table that has not rendered, so it distinguishes the two cases for free. Cheap relative to retracting a claim after it has been sent.
- **Phrase an unconfirmed negative as a question, not a statement.** The first client email on this said "the Backups tab shows nothing for us, which may just be a limit on what our account can see -- could you confirm from your side?" That hedge is the only reason a wrong reading did not become a wrong assertion.
- Same shape in any SPA admin UI (AWS console, Cloudflare dashboard, M365 admin center): chrome renders synchronously, data tables hydrate from XHR, and nothing in the text marks the difference.

Related: `kb/claude-code/sandboxed-bash-fakes-missing-dependency.md` -- an environment failure imitating a missing dependency, the same class of confident false negative from a tool whose output looked authoritative.
