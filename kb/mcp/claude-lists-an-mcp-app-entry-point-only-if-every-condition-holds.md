---
tech: mcp
tags: [mcp, mcp-apps, claude, connector, entry-point, ui-resource, tool-metadata]
severity: medium
---
# Claude lists an MCP App entry-point tool only if every condition holds, and shows no error when one fails

## PROBLEM
To appear under "open an app" in Claude, a connector's tool must meet several conditions at once. When one is missed, the tool still works when the model calls it, but the app is simply not offered, and nothing reports why. The conditions, as documented in Claude's connector docs at the time of writing:

- `_meta.ui.resourceUri` is set and is a `ui://` address
- there is no `visibility` key (the default already includes the model)
- the title is 60 characters or fewer and does not contain vendor names
- the name has no `__`, `..`, `._` or `_.`
- the input schema opens with `{}`, that is, the tool can be called with no arguments

## WRONG
```ts
const openHome = {
  name: "acme__open_home",                                   // "__" disqualifies it
  title: "Acme connections and account status overview for your workspace and teams", // over 60
  inputSchema: { type: "object", properties: { tab: { type: "string" } }, required: ["tab"] }, // needs input
  _meta: { ui: { resourceUri: "ui://acme/home", visibility: ["app"] } },                       // visibility key
};
```

## RIGHT
```ts
const openHome = {
  name: "open_home",
  title: "Connections",
  description: "Shows the user's connections and lets them connect apps.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  _meta: {
    ui: { resourceUri: "ui://home" },
    "ui/resourceUri": "ui://home",      // older flat key, written alongside for hosts that read it
  },
};
```

## NOTES
- Check the list of conditions again after any host update; they are documented by the host, not by the MCP spec.
- Put the conditions in a comment next to the tool definition and cover them in a unit test (name, title length, empty-input call, no `visibility`), because failing is silent.
- Prefer a no-argument entry point that opens a home view; the view can then take the user to anything else.
