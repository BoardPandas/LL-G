---
tech: salesforce
tags: [salesforce, soql, datetime, now, apex, rest]
severity: medium
---
# SOQL has no NOW(): compare datetimes with an unquoted ISO literal

## PROBLEM
SQL habit writes `Expires__c > NOW()`. SOQL has no functions in WHERE comparisons like that; the
REST query fails with `MALFORMED_QUERY`. Datetime literals are unquoted ISO 8601 in UTC, and
quoting them is also an error.

## WRONG
```sql
SELECT Id FROM Code__c WHERE Expires__c > NOW()
SELECT Id FROM Code__c WHERE Expires__c > '2026-11-19T15:04:05Z'
```

## RIGHT
```sql
SELECT Id FROM Code__c WHERE Expires__c > 2026-11-19T15:04:05Z
```
```js
const soqlDateTime = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
```

## NOTES
Date literals such as `TODAY` and `LAST_N_DAYS:7` exist; there is no current-datetime literal.
In Apex use a bind variable (`:Datetime.now()`).
