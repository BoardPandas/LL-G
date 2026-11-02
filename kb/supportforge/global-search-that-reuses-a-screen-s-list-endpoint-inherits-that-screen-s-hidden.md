---
tech: supportforge
tags: [search, personas, people, directory, filters, dashboard]
severity: high
---
# Global search that reuses a screen's list endpoint inherits that screen's hidden filter

## PROBLEM
The tab-bar search read people from `GET /v1/personas/list`, which only returns end users with an AI persona (`persona_portrait IS NOT NULL`), so most contacts could not be found at all.
Nothing errors: search returns their tickets but not the person, so it reads as "search is weak", not "search reads the wrong list". The Client Center People page had already dropped the persona filter for the same reason, but the search caller of the same endpoint was never updated.

## WRONG
```ts
// "people" search borrowed the Persona Lens list
fetch(`/api/v1/personas/list?limit=6&search=${encodeURIComponent(q)}`)
```

## RIGHT
```ts
// The CRM directory holds everyone the viewer may see; the server
// limits technicians to customers and CRM members to every stage.
fetch(`/api/v1/people/directory/people?limit=6&search=${encodeURIComponent(q)}`)
```

## NOTES
- When a list's scope changes on one screen, grep for every other caller of that endpoint.
- A customer has two profile pages for one record (Client Center and CRM); search lists each as its own result.
- Related: supportforge/list-cap-client-side-match (the same persona list, capped at 200).
