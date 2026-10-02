---
tech: react
tags: [react, react-compiler, eslint, react-hooks-purity, date, dialog, forms]
severity: medium
---
# react-hooks/purity rejects Date.now() and new Date() during render

## PROBLEM
The React Compiler lint rule `react-hooks/purity` treats `Date.now()` and `new Date()` called during render as an ERROR ("Cannot call impure function"). A dialog that validates "at least a minute from now" or seeds a default date/time in its render body fails `lint` and CI. Re-seeding with `new Date()` in a render-phase "when the dialog opens" adjustment is flagged the same way.

## WRONG
```tsx
function FollowUpDialog({ open }: { open: boolean }) {
  const [when, setWhen] = useState("")
  const valid = new Date(when).getTime() > Date.now() + 60_000 // error: impure in render
  // ...
}
```

## RIGHT
```tsx
function FollowUpDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <FollowUpForm />}</DialogContent>
    </Dialog>
  )
}
function FollowUpForm() {
  // Lazy initializer: runs once per mount (= once per opening), not during each render.
  const [openedAt] = useState(() => new Date())
  const [when, setWhen] = useState(() => toLocalInput(defaultDue(openedAt)))
  const valid = new Date(when).getTime() > openedAt.getTime() + 60_000
  // derive min/defaults from openedAt; the server re-validates against its own clock
}
```

## NOTES
Mounting the form only while open gives a fresh clock per opening without effects (which would trip `set-state-in-effect`). Seen in SupportForge's ticket follow-up dialog (#303).
