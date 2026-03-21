---
tech: nextjs
tags: [server-actions, auth, silent-failure, debugging]
severity: medium
---
# Silent empty returns from server actions hide auth failures

## PROBLEM
Server actions that return `[]` or `null` when authentication fails are indistinguishable from "user has no data" on the client side. Galleries, lists, and dashboards show an empty state with no indication that authentication actually failed. This makes debugging production issues extremely difficult because the UI looks "correct" (empty state) when it should be showing an error.

## WRONG
```typescript
"use server";

export async function getMyCustomThemes(): Promise<CustomTheme[]> {
  const user = await getAuthUser();
  if (!user) return [];  // Silent failure -- client thinks user has no themes
  return db.query.customThemes.findMany({ where: eq(customThemes.userId, user.id) });
}
```

## RIGHT
```typescript
"use server";

export async function getMyCustomThemes(): Promise<CustomTheme[]> {
  const user = await getAuthUser();
  if (!user) {
    // Log so failures are visible in server logs (Cloudflare, Vercel, etc.)
    console.warn("[getMyCustomThemes] getAuthUser() returned null");
    return [];
  }
  return db.query.customThemes.findMany({ where: eq(customThemes.userId, user.id) });
}
```

On the client side, add error handling for critical loads:
```typescript
const [themes, setThemes] = useState<CustomTheme[]>([]);
const [loadError, setLoadError] = useState(false);

useEffect(() => {
  getMyCustomThemes()
    .then(setThemes)
    .catch(() => {
      setLoadError(true);
      toast.error("Failed to load themes");
    });
}, []);
```

## NOTES
- The `console.warn` is critical -- without it, you have zero visibility into auth failures in production logs.
- Consider a standard prefix like `[functionName]` in all server action logs for easy filtering.
- On the client, distinguish between "loaded but empty" and "failed to load" with separate state variables or discriminated return types.
- This pattern compounds: if 5 server actions all silently return empty, the user sees a completely blank dashboard with no errors anywhere.
