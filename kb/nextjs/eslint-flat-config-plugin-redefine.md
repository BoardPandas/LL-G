---
tech: nextjs
tags: [eslint, eslint-config-next, flat-config, plugins, jsx-a11y]
severity: medium
---
# ESLint flat config: do not re-register a plugin eslint-config-next already provides

## PROBLEM
In an ESLint flat config that spreads `...nextCoreWebVitals` (from `eslint-config-next/core-web-vitals`), adding your own config object that re-declares a plugin namespace the Next config already registers makes ESLint refuse to load the config:

```
Config ... redefines plugin "jsx-a11y"
```

`eslint-config-next` already registers `react`, `react-hooks`, `@typescript-eslint`, `import`, and `jsx-a11y`. To turn on additional rules from one of those bundled plugins, you only set rule severities -- registering the plugin again in your block is both unnecessary and a hard error.

## WRONG
```js
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default [
  ...nextCoreWebVitals,
  {
    // jsx-a11y is ALREADY registered by eslint-config-next -> this throws
    plugins: { "jsx-a11y": jsxA11y },
    rules: { "jsx-a11y/control-has-associated-label": "warn" },
  },
];
// ESLint: Cannot redefine plugin "jsx-a11y"
```

## RIGHT
```js
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  ...nextCoreWebVitals,
  {
    // Plugin already loaded by eslint-config-next; just set the rule severity.
    rules: { "jsx-a11y/control-has-associated-label": "warn" },
  },
];
```

## NOTES
Only register a plugin yourself when eslint-config-next does NOT already bundle it. Keep newly enabled rules at "warn" rather than "error" if you do not want them to break `next build` on projects where lint runs during build. (Note: Next 16 does not run ESLint during build, but earlier majors do.)
