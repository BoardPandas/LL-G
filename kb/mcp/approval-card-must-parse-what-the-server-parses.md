---
tech: mcp
tags: [approval, confirmation, tool-arguments, json-string, ui]
severity: high
---
# An approval card that reads only the object form of an argument hides what the string form does

## PROBLEM
A tool handler is lenient about argument shape because models are: it accepts an array
or object, and also the same value as a JSON string. The approval card that a person
sees before a write is built separately, in the client, and reads the argument only when
it is already an array or object.

When the model sends the string form, the server parses it and acts on it, and the card
silently omits it. In the build that produced this entry a "change list" call carried a
`members` argument as a string. The card showed only "Change task list"; approving it
also shared the list with other people. The person approved an action they were never
shown.

## WRONG
```tsx
// Server: accepts both shapes.
const members = typeof args.members === 'string' ? JSON.parse(args.members) : args.members;

// Card: renders one shape, drops the other without a trace.
{Array.isArray(args.members) && <SharedWith members={args.members} />}
```

## RIGHT
```tsx
// One parser, shared by the handler and the card.
export function parseMembers(raw: unknown): Member[] | { unreadable: string } { /* ... */ }

const members = parseMembers(args.members);
{'unreadable' in members
  ? <RawArgument name="members" value={members.unreadable} />
  : <SharedWith members={members} />}
```

## NOTES
- The card must parse exactly what the server parses. Put the parser in a package both
  sides import; a copy drifts.
- Never drop an argument the card does not understand. Show it raw. An approval that
  hides an argument is worse than an ugly one.
- For arguments that widen access (sharing, recipients, permissions), always render the
  line, including the "no change" case, so its absence cannot be mistaken for "none".
- Test the card with the string form of every structured argument the handler accepts.
