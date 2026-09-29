---
tech: python
tags: [plex, plexapi, collections, tags, partial-object, data-loss]
severity: high
---
# plexapi addCollection rewrites the item's whole collection list

## PROBLEM
`EditTagsMixin.editTags` (behind `addCollection`, `addLabel`, `addGenre`, and the other `add*` tag methods) reads the item's current tag list (`getattr(self, 'collections')`) and sends it plus the new tag as `collection[0..n].tag.tag`, which replaces every collection on the item. On an item from a listing (`section.all()`, `search()`, `collection.items()`) with `_autoReload` off, or any partial object whose tag list Plex shortened, the list sent is incomplete, and the edit silently takes the item out of its other collections. The call succeeds and the new collection appears; only the others lose the item.

Removing is safe: `removeCollection` sends `collection[].tag.tag-` with only the named tag.

## WRONG
```python
for item in section.all():
    item.addCollection("Weekend")  # sends only the tags the listing carried
```

## RIGHT
```python
for listed in section.all():
    item = plex.fetchItem(listed.ratingKey)  # a full object, every tag
    if any(c.tag.casefold() == "weekend" for c in item.collections):
        continue
    item.addCollection("Weekend", locked=True)

item.removeCollection("Weekend", locked=True)  # names only this tag
```

## NOTES
- `locked=True` (the default) locks the field as Plex's own Edit dialog does, so a metadata refresh does not undo the change.
- `Collection.addItems` (PUT `/library/collections/{key}/items`) is one request for many items and touches no other tags, but does not lock the field.
- Plex keeps collections per library section: a show and a movie tagged with one name land in two collections.
- Related: [plexapi-partial-object-reloads-missing-fields.md](plexapi-partial-object-reloads-missing-fields.md).
