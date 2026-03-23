---
tech: typescript
tags: [dates, timezone, utc, intl, testing, vitest]
severity: medium
---
# Date-only strings parse as UTC, off-by-one in local timezone

## PROBLEM
`new Date("2026-01-15")` (date-only, no time component) is parsed as UTC midnight per the ECMAScript spec. When displayed using `Intl.DateTimeFormat` (which defaults to the local timezone), western hemisphere timezones (UTC-5 through UTC-10) will show the previous day. This causes tests to fail on machines in US/Canada/Latin America timezones while passing in UTC/Europe/Asia.

## WRONG
```typescript
// formatters.ts
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr); // "2026-01-15" -> UTC midnight
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
  }).format(date); // In CST: "Jan 14, 2026" (off by one!)
}

// test
expect(formatDate("2026-01-15")).toBe("Jan 15, 2026"); // FAILS in US timezones
```

## RIGHT
```typescript
// Option 1: Use datetime strings with explicit time in tests
expect(formatDate("2026-01-15T12:00:00Z")).toContain("Jan 15");

// Option 2: Match flexibly when timezone is not the point of the test
const result = formatDate("2026-01-15");
expect(result).toMatch(/Jan 1[45], 2026/); // Accepts either day

// Option 3: Fix the formatter to parse date-only strings as local
export function formatDate(dateStr: string): string {
  // Add T00:00:00 to force local timezone interpretation
  const normalized = dateStr.includes("T") ? dateStr : `${dateStr}T00:00:00`;
  const date = new Date(normalized);
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
  }).format(date);
}
```

## NOTES
- Per ECMAScript spec: date-only strings ("2026-01-15") are UTC. Date-time strings without offset ("2026-01-15T00:00:00") are local. This inconsistency is a known footgun.
- This primarily surfaces in test environments where you write exact assertions like `.toBe("Jan 15, 2026")`.
- CI servers often run in UTC, so tests pass in CI but fail on developer machines in US timezones.