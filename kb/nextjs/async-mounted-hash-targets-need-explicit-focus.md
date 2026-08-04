---
tech: nextjs
tags: [app-router, hash-navigation, async-rendering, accessibility, focus]
severity: high
---
# Async-mounted hash targets need explicit scroll and focus handling

## PROBLEM

A hash-only Next.js `Link` can appear to do nothing when its target is rendered
after client-side data finishes loading. The browser performs native fragment
navigation before the target exists, and a same-route App Router transition does
not reliably retry it when the element mounts. Repeated clicks may issue RSC
requests while the URL and viewport appear unchanged. Even when native scrolling
works, keyboard focus stays on the link instead of moving to the control the user
asked to use.

## WRONG

```tsx
<Link href="#billing-setup">Set up billing</Link>

{query.data && (
  <div id="billing-setup">
    <SelectTrigger id="billing-plan" />
  </div>
)}
```

## RIGHT

```tsx
const SETUP_HASH = "#billing-setup";

function focusSetup(): boolean {
  const region = document.getElementById("billing-setup");
  if (!(region instanceof HTMLElement)) return false;

  const control = document.getElementById("billing-plan");
  region.scrollIntoView({ block: "start" });
  const target =
    control instanceof HTMLElement && !control.matches(":disabled") ? control : region;
  target.focus({ preventScroll: true });
  return true;
}

function SetupAction() {
  return (
    <button
      type="button"
      onClick={() => {
        history.replaceState(history.state, "", SETUP_HASH);
        focusSetup();
      }}
    >
      Set up billing
    </button>
  );
}

// Run after the async loading state changes to ready.
useEffect(() => {
  if (!isLoading && location.hash === SETUP_HASH) focusSetup();
}, [isLoading]);

<section id="billing-setup" aria-label="Billing setup" tabIndex={-1}>
  <SelectTrigger id="billing-plan" />
</section>;
```

## NOTES

- Keep the fragment in the URL so reloads and copied links retain intent.
- Make the region programmatically focusable and use it as the fallback when the
  intended control is absent or disabled; otherwise blocked states still appear
  dead.
- Choose the focus target from current server-derived state. For example, an
  existing incomplete subscription should focus its management region rather
  than a disabled new-plan picker or a destructive cancel button.
- Respect `prefers-reduced-motion` if smooth scrolling is used.
- Test both click activation and a direct hash whose target mounts only after the
  loading state resolves.
