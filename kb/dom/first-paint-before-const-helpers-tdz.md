---
tech: dom
tags: [temporal-dead-zone, hoisting, modal, focus-trap, real-engine-test]
severity: high
---
# A first paint called above the `const` helpers it reaches throws on every open, and no unit test sees it

## PROBLEM
In a long setup function that mixes hoisted `function` declarations with `const` arrow helpers, a call placed above the `const`s can reach them through a hoisted function. The `const` is in the temporal dead zone, so the call throws `ReferenceError: Cannot access 'rows' before initialization`. In a modal builder this is the worst shape: the element is already appended and the focus trap already set, part of the content already painted, and the listeners (attached after the paint) never are. The window looks half-built, Close and Escape are dead, and the page behind stays inert. One such window shipped broken for six weeks: its tests covered only exported pure functions, the caller's try/catch turned the stack into a toast, and lint does not follow the call (`no-use-before-define` checks direct references only).

## WRONG
```js
export function openModal() {
	document.body.appendChild(el);
	const release = trapFocus(panel);
	paintAll();                       // throws: rows is in the TDZ
	el.addEventListener("click", onClick);   // never runs
	const rows = () => buildRows(state);
	function paintAll() { paintColors(); }
	function paintColors() { box.innerHTML = rows().map(rowHtml).join(""); }
}
```

## RIGHT
```js
export function openModal() {
	document.body.appendChild(el);
	const release = trapFocus(panel);
	el.addEventListener("click", onClick);
	const rows = () => buildRows(state);
	function paintAll() { paintColors(); }
	function paintColors() { box.innerHTML = rows().map(rowHtml).join(""); }
	// The first paint is the LAST statement. If it throws, take the dialog down.
	try {
		paintAll();
	} catch (err) {
		release();
		el.remove();
		throw err;
	}
}
```

## NOTES
Keep at least one test that opens the real thing in a real engine (a headless Chromium fixture over the production module). A pure-layer suite cannot see this, however large.
