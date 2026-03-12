---
tech: tailwind
tags: [dark-mode, configuration, class-strategy, media-strategy]
severity: medium
---
# Dark mode configuration

## PROBLEM
Tailwind supports two dark mode strategies: `media` (uses the OS/browser preference) and `class` (uses a `.dark` class on the `<html>` element). The `class` strategy does not activate automatically -- without adding `.dark` to `<html>`, dark mode classes silently have no effect even when the user's OS is set to dark mode.

## WRONG
```ts
// tailwind.config.ts
export default {
  darkMode: 'class',  // configured, but...
  // ...
}
```

```tsx
// html element never gets .dark class added
// Result: dark: classes never apply, no error
<html>
  <body>
    <div className="bg-white dark:bg-gray-900">...</div>
    {/* dark:bg-gray-900 silently never activates */}
  </body>
</html>
```

## RIGHT
```ts
// tailwind.config.ts -- choose one strategy and stick to it
export default {
  darkMode: 'class',  // for manual/app-controlled toggle
  // OR
  // darkMode: 'media',  // for OS preference only, no manual toggle
}
```

```tsx
// For 'class' strategy: add/remove .dark on <html> based on user preference
// In Next.js App Router, use next-themes:
import { ThemeProvider } from 'next-themes'

export default function RootLayout({ children }) {
  return (
    <html suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
```

## NOTES
- `media` strategy: zero setup, but no way to let the user override their OS preference in-app
- `class` strategy: requires managing the `.dark` class -- use `next-themes` in Next.js projects
- `suppressHydrationWarning` on `<html>` is required with `next-themes` to suppress the server/client class mismatch warning
- Tailwind v4 changes: dark mode configuration moves to CSS (`@custom-variant dark (...)`) -- check version before applying this pattern
