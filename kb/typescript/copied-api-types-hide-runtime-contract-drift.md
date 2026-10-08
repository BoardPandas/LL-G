---
tech: typescript
tags: [api-contracts, react, fixtures, testing, json]
severity: high
---
# Copied API types hide runtime contract drift

## PROBLEM

A browser type can claim an API returns `totalBalance` while the server serializes `totalCredits`. Each project type-checks independently, and mock fixtures copied from the browser type agree with the broken component. Calling `totalBalance.toLocaleString()` then crashes a live billing page. Thousands of green backend tests do not exercise the JSON-to-render boundary.

## WRONG

```ts
interface BrowserStatus { totalBalance: number }
const status: BrowserStatus = await response.json();
return status.totalBalance.toLocaleString();
// Tests repeat the same assumption:
mockFetch({ totalBalance: 100 });
```

## RIGHT

```ts
import type { CreditStatus } from '@app/contracts';
const status: CreditStatus = await response.json();
return (status.totalCredits ?? 0).toLocaleString();

// In a server test, verify the service output against the shared fixture.
expect(await getCreditStatus(tenantId)).toEqual(statusFixture);
// In a browser test, render actual consumers using that server-shaped fixture.
mockFetch(statusFixture);
render(<CreditBalance />);
expect(screen.getByText('100')).toBeVisible();
```

## NOTES

Prefer one shared contract or runtime response schema. If package boundaries require copied types, check assignability in both directions and compare property keys at compile time. The fixture must be tied to real server output, not just declared as the browser type. Test meaningful branch states such as zero balance, warning thresholds, disabled enforcement, custom zero values, and absent numeric fields. Defensive formatting prevents a blank page but does not prove the contract or balances are correct. Test write request payloads too: separately typed admin forms can submit valid JSON using field names the route never reads.
