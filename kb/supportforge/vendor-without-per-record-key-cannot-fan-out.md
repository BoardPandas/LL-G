---
tech: supportforge
tags: [portal-sync, multi-tenant, notion, integration-org-mappings, data-leak, scoping]
severity: high
---
# A vendor with no per-tenant key in its payload cannot be fanned out over the org-mapping table

## PROBLEM
`integration_org_mappings` resolves an external org id to a `client_id`, and most
portal syncs use it the same way: the vendor returns records already stamped with
an org id, the sync looks each one up, and writes it to that client. Huntress,
Pax8, QuickBooks, Meraki and Ubiquiti all work like this.

The pattern only holds because the *vendor's own payload* carries the
discriminator. Notion has none. `POST /v1/search` returns one flat list of every
page the integration token can see, and a page object contains nothing naming a
customer — only `id`, `parent`, and properties.

So "Notion is MSP-wide, fan it out over the mappings like the others" reads as a
one-line symmetry fix and is actually a cross-tenant leak: with no per-record key
to filter on, every mapped client receives the *entire* workspace. Each
customer's portal Docs section would list every other customer's documentation.
Nothing errors, the sync reports a healthy record count, and the damage is only
visible by logging into a customer portal.

The tell: before reusing the mapping table for a new vendor, ask what field in a
single returned record decides which client it belongs to. If you cannot name
one, fan-out is the wrong shape and the scoping has to be reconstructed from
structure instead.

For Notion that structure is page ancestry — map a *root page* per client
(`external_org_id` = the Notion page id), then walk each page's parent chain to
the nearest mapped root. Pages under no mapped root are written nowhere.

## WRONG
```ts
// "Same as Huntress/Pax8" — but no Notion record says which client it is.
export async function syncNotionForMsp(cred, mappings) {
  const pages = await fetchAllPages(cred.creds);   // the WHOLE workspace
  for (const m of mappings) {
    if (!m.clientId) continue;
    // Every mapped client gets every page. 20 clients => 20 copies of everyone's docs.
    await persistClientPages(cred.mspId, m.clientId, pages);
  }
}
```

## RIGHT
```ts
// Scope comes from page ancestry, because the payload cannot provide it.
// external_org_id holds a ROOT PAGE id, not an org id.
function findMappedRoot(pageId, pageMap, rootIds) {
  const visited = new Set();
  let current = pageId, depth = 0;
  while (current && !visited.has(current)) {
    if (rootIds.has(current)) return { rootId: current, depth };  // nearest root wins
    visited.add(current);
    const page = pageMap.get(current);
    if (!page || page.parent.type !== 'page_id') return undefined;
    current = page.parent.page_id;
    depth++;
  }
  return undefined;
}

const clientByRoot = new Map(
  mappings.filter(m => m.clientId).map(m => [m.externalOrgId, m.clientId])
);
if (clientByRoot.size === 0) return 0;          // no mappings => write NOTHING

for (const page of pages) {
  const root = findMappedRoot(page.id, pageMap, new Set(clientByRoot.keys()));
  if (!root) continue;                          // unmapped subtree is never published
  bucket(clientByRoot.get(root.rootId)).push(toNode(page, root.depth));
}
```

## NOTES
- Checking the nearest mapped ancestor (rather than the topmost) lets a nested
  root override an outer one, so a shared parent page can hold per-client
  sections.
- Derive `depth` relative to the client's own root, not the workspace root, or
  every client's doc tree renders starting at an arbitrary indent.
- Fetch the page index first and pull block content only for pages that survive
  the filter — otherwise you pay a recursive block crawl for pages you discard.
- The prune that follows a scoped sync must be guarded on a non-empty fetch; see
  the empty-result sweep gotcha in `kb/postgres/empty-result-any-sweep-deletes-everything.md`.
  A revoked Notion token returns `[]`, not an error.
- Related: [[connected-badge-hides-a-sync-that-never-ran]].
