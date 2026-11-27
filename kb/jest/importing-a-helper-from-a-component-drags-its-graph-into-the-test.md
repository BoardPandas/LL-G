---
tech: jest
tags: [imports, esm, module-graph, test-isolation]
severity: medium
---
# Importing one small function from a component file drags its whole import graph into an unrelated test

## PROBLEM
A keyboard hook needs `dispatchRowCommand()`, which lives beside the component that listens for it. That component imports a modal, which imports a combobox, which imports an auth context, which imports an ESM-only client. A test for a different hook in the same file now fails to load with "Must use import to load ES Module", although nothing it exercises changed. It passes for the author, whose focused test run mocked the modal.

## WRONG
```tsx
// useListKeyboard.ts
import { dispatchRowCommand } from './RowCommands' // RowCommands.tsx imports the modal

// RowCommands.tsx
import { TimeEntryModal } from './TimeEntryModal' // -> ... -> ESM-only auth client
```

## RIGHT
```tsx
// row-command-bus.ts: no imports
export const EVENT = 'app:row-command'
export const dispatchRowCommand = (command, id) =>
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { command, id: String(id) } }))

// both the hook and the component import from row-command-bus
```

## NOTES
Fix the graph rather than adding a jest.mock to every suite that happens to import the hook. The error names the ESM file; the require stack under it shows the hop to cut. Run the whole directory, not only the new test, before calling a change done.
