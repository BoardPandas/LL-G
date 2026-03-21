---
tech: nextjs
tags: [server-actions, error-handling, throws, 500]
severity: medium
---
# Next.js server actions turn thrown errors into generic 500 responses

## PROBLEM
When a server action throws an error (e.g., `throw new Error('Not authenticated')`), Next.js intercepts the throw and returns a generic 500 response with the message "An unexpected response was received from the server." The original error message is NOT forwarded to the client. The client's `.catch()` handler receives an opaque error with no useful information.

This makes it impossible to distinguish different failure modes on the client side when using throws.

## WRONG
```typescript
"use server";

export async function getMyThemes() {
  const user = await getAuthUser();
  if (!user) {
    // Client sees: "An unexpected response was received from the server."
    // The message "Not authenticated" is lost.
    throw new Error("Not authenticated");
  }
  return db.query.themes.findMany({ where: eq(themes.userId, user.id) });
}
```

## RIGHT
```typescript
"use server";

// Option A: Return discriminated results
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function getMyThemes(): Promise<ActionResult<Theme[]>> {
  const user = await getAuthUser();
  if (!user) {
    console.warn("[getMyThemes] Auth returned null -- user not authenticated");
    return { ok: false, error: "Not authenticated" };
  }
  const data = await db.query.themes.findMany({ where: eq(themes.userId, user.id) });
  return { ok: true, data };
}

// Option B: Return empty with server-side logging (simpler for read-only actions)
export async function getMyThemes(): Promise<Theme[]> {
  const user = await getAuthUser();
  if (!user) {
    console.warn("[getMyThemes] Auth returned null -- returning empty");
    return [];
  }
  return db.query.themes.findMany({ where: eq(themes.userId, user.id) });
}
```

## NOTES
- This behavior is by design in Next.js -- it prevents leaking server-side error details to the client.
- If you need the client to know WHY something failed, use discriminated return types (Option A).
- If the action is read-only and an empty result is acceptable, use Option B but always add `console.warn` so failures are visible in server logs.
- This applies to all server actions, not just auth-related ones.
