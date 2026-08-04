---
tech: typescript
tags: [datetime, iana, timezone, dst, recurrence, intl]
severity: high
---
# UTC-day recurrence drifts IANA wall clocks across DST

## PROBLEM
A recurring schedule stores an absolute instant plus an IANA timezone. Advancing
the instant by 24-hour UTC days and checking the formatted local weekday appears
timezone-aware, but the local hour silently shifts after a daylight-saving
transition. Jobs keep running and stay on the expected weekday, so monitoring
and tests that assert only day-of-week miss the wrong wall-clock output.

## WRONG
```ts
const next = new Date(current);
do {
  next.setUTCDate(next.getUTCDate() + 1);
} while (!allowedDays.includes(weekdayInZone(next, timeZone)));
return next;
```

## RIGHT
```ts
const local = getZonedDateTimeParts(current, timeZone);
const nextLocalDate = findNextAllowedCalendarDate(allowedDays, timeZone, from);
return wallClockToInstant(
  { ...nextLocalDate, hour: local.hour, minute: local.minute },
  timeZone,
);
```

## NOTES
Resolve each next local calendar date back into an instant in the stored IANA
zone. Define DST disambiguation explicitly: a nonexistent spring-forward time
moves forward by the gap, while a repeated fall-back time chooses the earlier
instant. Test exact local HH:mm and UTC instants across both DST boundaries in
more than one US zone; weekday-only assertions are insufficient.
