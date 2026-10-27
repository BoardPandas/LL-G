---
tech: graph-api
tags: [message-trace, messagetraces, exchange-online, odata, filter, endswith, wildcard, silent-wrong-output, beta]
severity: high
---
# Graph message trace ignores endswith(senderAddress) and returns the whole tenant's mail; filter a domain with senderAddress eq '*@domain'

## PROBLEM
The beta Graph message trace API (`GET /admin/exchange/tracing/messageTraces`) silently ignores `endswith(senderAddress,'@contoso.com')` and returns unfiltered tenant mail, inbound included, with a 200.

`endswith` is the normal OData way to filter by domain, and it works on other Graph collections. Here it raises no error and no warning, and the results look plausible: a page of mail with a mix of senders. A script meant to count outbound mail from one domain instead counts every inbound newsletter, notification and spam message in the tenant. The API takes the Exchange cmdlet's wildcard form instead: `senderAddress eq '*@contoso.com'`.

Verified on a live tenant in October 2026. The `endswith` query returned exactly the same first page as a query with no sender filter: third-party senders delivering to internal recipients. The wildcard form returned only that domain's senders, and the returned `$skiptoken` decoded to `"SenderAddress":"*@contoso.com"`, confirming the filter reached the server.

## WRONG
```http
GET https://graph.microsoft.com/beta/admin/exchange/tracing/messageTraces
    ?$filter=receivedDateTime ge 2026-10-17T00:00:00Z
         and receivedDateTime le 2026-10-27T00:00:00Z
         and endswith(senderAddress,'@contoso.com')
    &$top=5000
```
200 OK, every message in the tenant for the window. Counting these rows as "mail sent by contoso.com" is wrong by an order of magnitude.

## RIGHT
```http
GET https://graph.microsoft.com/beta/admin/exchange/tracing/messageTraces
    ?$filter=receivedDateTime ge 2026-10-17T00:00:00Z
         and receivedDateTime le 2026-10-27T00:00:00Z
         and senderAddress eq '*@contoso.com'
    &$top=5000
```

Then assert the filter was applied before trusting any count:

```python
foreign = [r for r in rows if not r["senderAddress"].lower().endswith("@contoso.com")]
if foreign:
    raise RuntimeError(f"sender filter not applied: {len(foreign)} rows from other domains")
```

## NOTES
- `$select` is also ignored: every row comes back with all fields, subject included. Strip what you do not need before storing results.
- One row per recipient. The `id` field is shared by every recipient row of the same message, so group by `id` to count messages and recipients per message (for example, finding sends to more than 50 people).
- A query may span at most 10 days (400 "The interval between StartDate and EndDate can't be longer than 10 days"), the same cap as the cmdlet: see exchange-online/get-messagetracev2-10-day-cap. Retention is about 90 days.
- `$top=5000` is accepted; follow `@odata.nextLink`. If your client caps the rows it pages through, check for truncation and split the window rather than accepting a short result.
- Calling this API at all needs a tenant service principal and a separate app role; see the companion graph-api entry on message trace provisioning 403s.
