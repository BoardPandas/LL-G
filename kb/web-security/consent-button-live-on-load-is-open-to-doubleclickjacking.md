---
tech: web-security
tags: [doubleclickjacking, clickjacking, consent, oauth, x-frame-options, frame-ancestors, ui-redress]
severity: high
---
# A consent button enabled as soon as the page loads can be hit by the second click of a staged double-click (DoubleClickjacking)

## PROBLEM
An attacker's page stages a double-click: it gets the visitor to double-click a spot on something it controls, arranged so that after the first click your consent or confirmation page is what sits under the pointer, with the Allow button at that spot. The second click of the double-click lands on your button. The visitor never saw your page before approving.

No framing is involved: your page is a top-level document. `X-Frame-Options` and `frame-ancestors` therefore do not help, and neither does `SameSite`, because the navigation is top-level and the click is a real user gesture.

## WRONG
```html
<!-- Live from the first paint: the second click of a double-click approves. -->
<form method="post" action="/oauth/decision">
  <button name="decision" value="allow">Allow</button>
</form>
```

## RIGHT
```js
// Decision buttons start disarmed. Arm them only after the document has been
// visible and focused for a moment AND has itself received an interaction.
const buttons = document.querySelectorAll("[data-decision]");
let seenInteraction = false, timer = null;

const disarm = () => { clearTimeout(timer); timer = null; buttons.forEach((b) => (b.disabled = true)); };
const maybeArm = () => {
  if (timer || !seenInteraction || document.visibilityState !== "visible" || !document.hasFocus()) return;
  timer = setTimeout(() => buttons.forEach((b) => (b.disabled = false)), ARM_DELAY_MS);
};

disarm();
for (const type of ["pointermove", "keydown"]) {
  document.addEventListener(type, () => { seenInteraction = true; maybeArm(); });
}
window.addEventListener("focus", maybeArm);
window.addEventListener("blur", disarm);                      // disarm on blur
document.addEventListener("visibilitychange", () => (document.visibilityState === "visible" ? maybeArm() : disarm()));
```

## NOTES
- Apply it to every button that grants something: OAuth consent, device approval, "delete account", payment confirmation.
- Keep the frame headers as well; they stop ordinary clickjacking. They are not sufficient.
- The delay is a judgement call (it must outlast a double-click); the entry does not prescribe a value.
- Related: `kb/mcp/authorize-on-session-cookie-is-consent-bypass.md` recommends frame headers on the consent page; this entry is the case those headers do not cover.
