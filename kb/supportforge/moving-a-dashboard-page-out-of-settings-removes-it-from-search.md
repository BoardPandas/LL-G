---
tech: supportforge
tags: [dashboard, search, navigation, settings-map, former-names, page-move]
severity: high
---
# Moving a dashboard page out of Settings silently removes it from search

## PROBLEM
The dashboard's "Pages & settings" search is derived, not listed by hand:
settings entries come from the settings map (`lib/settings/map/*.ts` through
`lib/settings/search-index.ts`), and every other workspace's entries come from
its static nav tree (`navDestinations` in `lib/search/destinations.ts`).

That is what keeps search honest, and it has two blind spots when a page
leaves Settings for another workspace:

1. **The old name stops matching.** The settings map carried the page's label
   and former names. The new nav row carries only its new label, so a search
   for what people have always called it finds nothing.
2. **A nav built from live data is not collected at all.** The Tickets nav is
   assembled in a hook from saved views and boards, so a row added there
   (Deleted tickets, On-call) is in the sidebar and absent from search.

Nothing fails: the page is reachable, the redirect from the old URL works, the
nav test passes. The page is simply no longer findable by name.

A third, related gap: a row the nav shows only to holders of a capability must
be filtered in `navDestinations` too, because search reads the static tree, not
the filtered one the sidebar renders.

## WRONG
```ts
// rmm.ts: the page moved here from Settings, under a new label.
{ label: 'Platform health', href: '/rmm/platform-health', icon: HeartPulse },
// Searching "RMM health" (its Settings label) now returns nothing.
```

## RIGHT
```ts
// The nav row answers to the name it had as a Settings row.
{ label: 'Platform health', href: '/rmm/platform-health', icon: HeartPulse,
  formerly: [{ label: 'RMM health', location: 'Settings' }] },

// destinations.ts: pass keywords and former names through for non-settings navs...
if (item.keywords) destination.keywords = item.keywords
if (item.formerly) destination.formerly = item.formerly

// ...list by hand what a live-data nav cannot contribute, under the row's own rule...
if (ticketsAdmin.allows(viewer)) out.push({ label: 'Deleted tickets', href: '/tickets/deleted', section: 'Tickets' })

// ...and apply the same capability filter the sidebar applies.
if (reaches('rmm')) collect('RMM', rmmNavFor(capabilities), out)
```

## NOTES
- Add a search test when a page moves: the old name returns the new href, with
  the "was in Settings" note, for a viewer who can open it and not for one who
  cannot.
- Inside Settings the same idea is data only: add `formerly` (and `keywords`)
  to the page, tab or setting that now holds the thing.
- Related: `global-search-that-reuses-a-screen-s-list-endpoint-inherits-that-screen-s-hidden.md`.
