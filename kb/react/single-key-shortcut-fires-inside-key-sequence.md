---
tech: react
tags: [keyboard, shortcuts, hotkeys, key-sequence]
severity: high
---
# A single-key shortcut also fires as the last key of a key sequence

## PROBLEM
Sequence shortcuts (`g t`, `g a`) and single-key shortcuts (`t`, `a`) are usually separate `keydown` listeners on `window`. Neither knows about the other, so the second key of a sequence also triggers the single-key handler. It stays invisible while the single key is harmless (`g t` went to a page and also cycled the theme for months). It becomes a wrong write the day someone binds a single key to an action: `g a` (go to admin) also ran `a` (assign this ticket to me) on the way out.

## WRONG
```tsx
// two unrelated hooks, both listening on window
useKeySequence(['g', 'a'], goToAdmin)
useHotkey('a', assignToMe) // also fires on the "a" of "g a"
```

## RIGHT
```tsx
const LEADERS = new Set(['g'])
let leaderAt = 0
// capture phase: the mark is set before any single-key handler runs
window.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
  if (LEADERS.has(e.key.toLowerCase())) leaderAt = Date.now()
  else setTimeout(() => { leaderAt = 0 }, 0) // after every listener saw this key
}, true)

export const followsLeaderKey = (e) =>
  !LEADERS.has(e.key.toLowerCase()) && leaderAt > 0 && Date.now() - leaderAt < 1500

// in every single-key handler
if (followsLeaderKey(e)) return
```

## NOTES
Hand-rolled window handlers (a table keyboard handler, an editor shortcut hook) need the same guard; a shared `useHotkey` only covers its own callers. Test with a real key sequence, not the two shortcuts in isolation.
