---
tech: react
tags: [react-compiler, react-hooks, refs, eslint, custom-hooks, lint]
severity: medium
---
# A hook returning a ref inside its result object makes every property read of that object a ref access

## PROBLEM

`react-hooks/refs` ("Cannot access refs during render") does not only fire where
you read `.current`. If a custom hook returns an object that *contains* a ref,
the compiler's alias analysis marks the whole returned object as a ref value.
Every property read of it during render then errors -- including reads that have
nothing to do with refs, like spreading a style object or passing a boolean to
`cn()`.

What makes this expensive to diagnose is where the errors land. They are
reported on the *caller's* JSX, dozens of lines from the hook, and the flagged
expressions look innocent:

```
> 358 |       style={resize.styleVars}
      |              ^^^^^^^^^^^^^^^^ Cannot access ref value during render
```

`styleVars` is a `useMemo` result. Nothing about that line involves a ref. The
actual cause is one property on the other end of the hook, and the message never
names it.

It is also commonly *masked*. The rule reports a limited number of violations per
scope, so as long as the component has a more obvious violation (a
`ref.current = value` write during render, say), these never appear. Fixing the
obvious one makes a pile of new errors materialise on lines you did not touch --
see [immutability-hoist-unmasks-set-state-in-effect](immutability-hoist-unmasks-set-state-in-effect.md)
for the same unmasking dynamic on a different rule. Before assuming your edit
introduced them, revert it and re-lint: if the count is unchanged, they were
latent.

## WRONG

```tsx
// useComposerResize.ts -- creates the DOM ref and returns it in the result
export interface ComposerResize {
  editorRef: React.RefObject<HTMLDivElement | null>  // <-- poisons the object
  height: number | null
  styleVars: React.CSSProperties
  dragging: boolean
  onHandlePointerDown: (e: React.PointerEvent) => void
}

export function useComposerResize(): ComposerResize {
  const editorRef = React.useRef<HTMLDivElement | null>(null)
  // ...
  return { editorRef, height, styleVars, dragging, onHandlePointerDown }
}

// Composer.tsx -- EVERY one of these reads is now a react-hooks/refs error
const resize = useComposerResize()

<div style={resize.styleVars}>                        {/* error */}
  <div
    aria-valuenow={resize.height ?? undefined}        {/* error */}
    onPointerDown={resize.onHandlePointerDown}        {/* error */}
    className={cn("...", resize.dragging && "bg-2")}  {/* error */}
  />
  <div ref={resize.editorRef}>                        {/* error */}
    <EditorContent editor={editor} />
  </div>
</div>
```

## RIGHT

Invert the ownership: the caller creates the ref and passes it in, so the
returned object holds no ref and stays an ordinary value.

```tsx
// useComposerResize.ts -- takes the ref, does not return one
export interface ComposerResize {
  height: number | null
  styleVars: React.CSSProperties
  dragging: boolean
  onHandlePointerDown: (e: React.PointerEvent) => void
}

export function useComposerResize(
  editorRef: React.RefObject<HTMLDivElement | null>
): ComposerResize {
  // ...
  return { height, styleVars, dragging, onHandlePointerDown }
}

// Composer.tsx -- clean; the ref is used only as a ref prop, never read
const editorSurfaceRef = React.useRef<HTMLDivElement | null>(null)
const resize = useComposerResize(editorSurfaceRef)

<div style={resize.styleVars}>
  <div ref={editorSurfaceRef}>
    <EditorContent editor={editor} />
  </div>
</div>
```

## NOTES

- Passing a ref object to a `ref=` prop is fine and is not flagged. The rule is
  about *reading* a ref (or reading from something it believes is one) during
  render.
- Moving the ref to a parameter makes it an ordinary dependency: `useCallback`s
  inside the hook that use it will start reporting `exhaustive-deps` warnings,
  because the linter no longer knows it is a stable `useRef` result. Add it to
  the dependency arrays -- a ref object's identity is stable, so this changes
  nothing at runtime.
- Destructuring at the call site (`const { styleVars } = useComposerResize()`)
  does NOT help. Destructuring is a property read like any other.
- The same analysis flags a ref captured by a closure handed to a third-party
  library during render, e.g.
  `Placeholder.configure({ placeholder: () => placeholderRef.current() })`
  ("Passing a ref to a function may read its value during render"). The rule
  cannot see past the library boundary to learn the callback only runs after
  mount, so that one is a genuine false positive and warrants a narrow
  `eslint-disable-next-line react-hooks/refs` with the reason recorded.
- Symptom-level tell: the flagged expressions all share one receiver object, and
  at least one property of that object is a ref. Grep the hook's return
  statement before touching the caller at all.
