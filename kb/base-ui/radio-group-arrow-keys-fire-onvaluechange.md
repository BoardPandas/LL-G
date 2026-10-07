---
tech: base-ui
tags: [base-ui, radio-group, onValueChange, keyboard, arrow-keys, irreversible-action, confirmation, autofocus, jsdom, testing, accessibility]
severity: high
---
# Base UI RadioGroup fires onValueChange on arrow-key focus, so a decision wired to it commits on one keystroke

## PROBLEM

In `@base-ui/react` 1.7.0, `RadioGroup`'s `onKeyDownCapture` marks the group
touched on any `Arrow*` key, and each `Radio.Root`'s `onFocus` then clicks its own
hidden input. Moving focus with the arrow keys therefore SELECTS each option it
passes and fires `onValueChange`. Tabbing in does not; arrowing does.

That is the WAI-ARIA radio-group pattern (selection follows focus), not a library
bug -- but it means any handler that commits an irreversible action from
`onValueChange` (approve / reject, delete, send, charge) commits on a single
keystroke from a keyboard user who was only moving between options. No button
pressed, no confirmation.

Two follow-on traps, both of which bite on the first attempt at a fix:

1. `autoFocus` on the confirmation's commit button re-creates the hazard one step
   along: the first arrow key opens the confirmation AND moves focus to a commit
   button, where Enter is the next key anyone presses.
2. A unit test of the pure `decide()` function proves nothing. The defect is a
   side effect of focus handling, and only a real DOM (jsdom or a browser) that
   sends the key shows it.

## WRONG

```tsx
<RadioGroup onValueChange={(value) => recordDecision(value)}>
  <Radio.Root value="approved" aria-label="Approve" />
  <Radio.Root value="rejected" aria-label="Reject" />
</RadioGroup>
// ArrowDown from "Approve" records "rejected".
```

## RIGHT

```tsx
const [pending, setPending] = useState<string | null>(null);

<RadioGroup value={pending} onValueChange={setPending}>  {/* selection only stages */}
  <Radio.Root value="approved" aria-label="Approve" />
  <Radio.Root value="rejected" aria-label="Reject" />
</RadioGroup>

{pending && (
  <div role="group" aria-label="Confirm decision">
    {/* No autoFocus: focus stays on the radio the user is navigating */}
    <button type="button" onClick={() => recordDecision(pending)}>Confirm</button>
    <button type="button" onClick={() => setPending(null)}>Cancel</button>
  </div>
)}
```

```tsx
// DOM test (Testing Library + user-event on jsdom)
render(<DecisionControl onDecide={onDecide} />);
screen.getAllByRole('radio')[0].focus();
await user.keyboard('{ArrowDown}{ArrowDown}');
expect(onDecide).not.toHaveBeenCalled();
```

## NOTES

- The commit path must be reachable ONLY from an explicit button press.
- Verify the DOM test by reintroducing the defect (commit from `onValueChange`)
  and confirming it goes red; a test that cannot fail is not a guard.
- Applies to any selection-follows-focus widget: tabs with `activateOnFocus`,
  listboxes, toolbars with toggle groups.
