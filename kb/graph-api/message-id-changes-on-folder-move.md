---
tech: graph-api
tags: [mail, messages, message-id, internetMessageId, app-only, mailbox, sync, 404, ErrorItemNotFound]
severity: high
---
# A stored mail message id goes stale when the item moves folder (and is mailbox-scoped)

## PROBLEM
Two independent traps make a message id you captured earlier fail with
`404 ErrorItemNotFound` ("The specified object was not found in the store."):

1. **Default message ids are folder-scoped and change on move.** Graph's default
   (non-immutable) `message.id` encodes the containing folder. The moment Outlook
   moves the item — an inbox rule, auto-archive, the user filing it, a quarantine
   release, even Focused/Other reclassification — the id you stored points at
   nothing. The message still exists and is still readable; only the id is dead.
2. **Ids are mailbox-scoped.** An id harvested app-only from
   `/users/{mailbox}/messages` is meaningless against `/me`. A tenant-wide sweep
   stores ids from many mailboxes, so re-reading them through the signed-in
   user's delegated connection 404s for every mailbox that isn't theirs.

Both are hard to spot because sync keeps working — you only fail on the *second*
read, often weeks later, and only for some messages. It reads as data corruption
or a permissions problem, not an id-lifetime problem. If you don't map
`GraphError` to a typed API error, it also surfaces as a bare
`500 Internal server error` with the real Graph code buried in server logs.

## WRONG
```typescript
// Synced app-only from /users/{mailbox}/mailFolders/inbox/messages/delta,
// then re-read through whoever happens to be signed in.
const graph = new GraphClient({ accessToken: delegatedToken }); // -> /me
const message = await graph.getMessage(interaction.raw.graphId);
// 404 ErrorItemNotFound once the item leaves the folder it was synced from,
// and always for mail belonging to any other mailbox.
```

## RIGHT
```typescript
// 1. Record which mailbox each message was read from, at sync time.
raw: { graphId: message.id, internetMessageId: message.internetMessageId, mailbox };

// 2. Re-read from THAT mailbox (app-only), not from /me.
const graph = new GraphClient({ accessToken: appOnlyToken, mailbox });

// 3. Fall back to internetMessageId, which survives folder moves.
async function fetchMessage(graph, graphId, internetMessageId) {
  if (graphId) {
    try {
      return await graph.getMessage(graphId);
    } catch (error) {
      if (!(error instanceof GraphError && error.status === 404)) throw error;
    }
  }
  const params = new URLSearchParams({
    // Mailbox-wide /messages spans every folder, so a moved item is still found.
    $filter: `internetMessageId eq '${internetMessageId.replaceAll("'", "''")}'`,
    $top: "1",
  });
  const page = await graph.request(`/users/${encodeURIComponent(mailbox)}/messages?${params}`);
  return page.value?.[0] ?? null;
}
```

## NOTES
- `internetMessageId` is the RFC 5322 `Message-ID` header (`<abc@host>`), assigned
  by the sending server and stable for the life of the item — across folder moves
  and across mailboxes. Store it alongside the Graph id; it is the durable key.
- The permanent alternative is **immutable ids**: send `Prefer: IdType="ImmutableId"`
  on mail requests. Do not retrofit this onto a running sync — id type is fixed per
  request, an existing delta link keeps emitting default ids, and mixing the two
  makes lookups fail in a new way. It is a clean-slate choice.
- Query the mailbox-wide `/messages` collection for the fallback, not
  `/mailFolders/{id}/messages` — the whole point is that you no longer know the
  folder.
- `URLSearchParams.toString()` encodes spaces as `+`, which Graph's OData parser
  accepts; a literal `+` inside the value is correctly escaped to `%2B`. Assert on
  `new URL(u).searchParams.get("$filter")` in tests, since `decodeURIComponent`
  will not turn `+` back into a space and the assertion looks wrong when it isn't.
- Map `GraphError` at your API boundary (404 -> not_found, 403 -> forbidden) so the
  upstream code reaches the caller instead of a generic 500.
- Related: `pagination.md`, `app-only-cannot-read-inbox-rules.md`.
