---
tech: architecture
tags: [spoilers, any-of, reveal-set, visibility-filter, oracle-test]
severity: high
---
# Clamp an any-of reveal set to what the reader has read before serving it

## PROBLEM
A row revealed by ANY of several works (e.g. `books: [1, 4]`) is visible when one of them is read. If the
filter returns the row unchanged, its `books` still lists the unread work, and a derived `book` (the earliest
ordinal) can BE the unread work. The UI then shows "First appears in <unread book>", groups facts under it, and
the payload tells the reader the character also turns up in a book they have not read. A scope or collection
filter applied to the unclamped set leaks the same way. Leak tests that grep for hidden names never notice.

## WRONG
```ts
const facts = full.facts.filter((f) => f.books.some((b) => read.has(b)));
```

## RIGHT
```ts
const seen = (books: readonly number[]) => books.filter((b) => read.has(b));
const clamp = <T extends { books: number[]; book: number }>(r: T): T => {
  const books = seen(r.books);
  return { ...r, books, book: books[0]! };
};
const facts = full.facts.filter((f) => f.books.some((b) => read.has(b))).map(clamp);
// and in the independent test oracle, on every mask:
for (const row of served) if (row.books.some((b) => !read.has(b)) || !read.has(row.book)) leaks.push(row.id);
```

## NOTES
Apply the clamp before anything derived from the set (death status ordering, scope narrowing, detail pages).
For single-work rows it is the identity, so existing golden snapshots stay byte-identical.
