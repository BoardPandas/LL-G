---
tech: supportforge
tags: [dashboard, url-params, workspace-tabs, tab-routes, command-params, guard-test]
severity: medium
---
# Every URL parameter a dashboard page reads must be classified, and one that does something must be a command

## PROBLEM
The dashboard's workspace tabs remember the last URL each tab was on and replay it when the tab is clicked. `dashboard/src/lib/tabs/tab-routes.ts` classifies every query parameter a page reads as a command (stripped before the URL is stored), an identity, or page state (kept). A guard test, `dashboard/src/lib/tabs/__tests__/tab-param-classification.test.ts`, scans the source for parameter reads and fails on any name that is not classified.

Two ways to get it wrong:

1. Add a parameter and the guard fails. It lives in `src/lib/tabs`, far from the page you changed, and a targeted test run of your own folder does not include it. It surfaces only in the full dashboard suite.
2. Classify an action parameter as state to make the guard pass. A parameter whose arrival DOES something (`?power=restart` opens the power form, `?run=1` opens the run drawer, a file tool's `action`, `path` and `target`) is then stored in the tab's URL and fires again every time the tab is clicked.

## WRONG
```ts
// tab-routes.ts
export const STATE_PARAMS = new Set([..., 'power', 'run']) // replays on every tab click
```

## RIGHT
```ts
// tab-routes.ts
export const COMMAND_PARAMS = new Set([
  ...,
  'power', // RMM device: open the power form
  'run',   // RMM device: open the run-script drawer
])
export const STATE_PARAMS = new Set([..., 'layout', 'section', 'severity', 'state', 'type'])
```

## NOTES
- The test: does arriving with the parameter change something other than what is shown? If yes, it is a command.
- The guard sees only string-literal reads (`params.get('name')`). A key held in a constant is invisible to it, so classify those by hand.
- Also strip a command parameter from the URL when the page navigates within itself (changing tab or tool), so Back does not reopen the form.
- Run `pnpm --dir dashboard exec jest src/lib/tabs` after adding any parameter.
