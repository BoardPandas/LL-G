---
tech: llm-integration
tags: [account detection, plan name, organization name, ui labels, claude.ai, claude desktop, chatgpt, browser extension, classification]
severity: medium
---
# Account detection by UI label works only on claude.ai

## PROBLEM
A rule that reads the account label from an AI app's UI classifies accounts differently on each surface. Claude Desktop's account button shows the plan name. claude.ai's account button shows the organization name. The ChatGPT desktop and web apps show neither. A parser that matches one label per product therefore works on claude.ai and returns nothing, or the wrong value, on the others.

When the label is missing, the rule must report "unknown". A default such as "free tier" turns a missing label into a wrong classification without any error.

## WRONG
```ts
// Same parser for every surface; the label means different things on each
const plan = accountButtonText.match(/Pro|Max|Team|Free/)?.[0] ?? "free";
```

## RIGHT
```ts
type AccountLabel = { surface: "claude.ai" | "claude-desktop" | "chatgpt"; kind: "org" | "plan" };

function classifyAccount(label: AccountLabel | null) {
  if (!label) return { status: "unknown" as const };
  return { status: "known" as const, label };
}
```
Key each parser by surface, and prefer the product's authenticated identity or account endpoint where one is available over reading the rendered label.

## NOTES
- Keep the per-surface parsers in one place with a test per surface, so a UI change on one product fails its own test rather than silently reclassifying accounts.
- Desktop-app wording and layout change between releases. Verify the labels again after each app update.
