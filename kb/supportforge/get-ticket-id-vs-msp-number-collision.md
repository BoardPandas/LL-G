---
tech: supportforge
tags: [tickets, mcp, ticket-number, id-collision, cross-client, silent-wrong-output, identifiers]
severity: high
---
# A bare ticket number is the display number: get_ticket(N) prefers msp_ticket_number, and a colliding internal id is shadowed

## PROBLEM
Every ticket tool takes "ticket id or MSP ticket number" in one parameter, and the two namespaces overlap:
- `msp_ticket_number` is the number in the dashboard URL (`/tickets/<msp-slug>/195`) and is a **small integer** (87, 111, 177, 195 ...).
- `id` is the internal primary key. Modern rows are large (226813, 227010), but **legacy Zendesk-imported rows have small ids in the exact same range**, with `msp_ticket_number: null`.

When both interpretations exist, the platform picks one and never says it made a choice. **Which one it picks changed**, and this entry used to describe the old answer:

- **Until 2026-07-21** the internal id won. `get_ticket(195)` returned legacy id 195, a closed Fabrikam ticket from 2025, when the operator meant `/tickets/<msp-slug>/195`, a live workstation ticket at Contoso (id 227010). The resolver intended the opposite, but its `ORDER BY (msp_ticket_number = $2) DESC` ranked the NULL of a legacy row first (see `kb/postgres/order-by-desc-nulls-first.md`).
- **Since 2026-07-21** the display number wins. Every ticket tool and HTTP route resolves through one helper, `resolveTicketInMsp`, which matches the display number first and falls back to the internal id only when no ticket in the MSP has that display number.

So the earlier advice here, "resolve to the internal id and pass that", is now the hazard in the other direction. An internal id is only a fallback: pass one that equals some ticket's display number and you get that other ticket, well-formed, for **the wrong client**, with no error. In an MSP context that is both a cross-client data exposure and a live remediation hazard.

## WRONG
```
# Treating the internal id as the unambiguous form.
get_ticket(195)        # meant the legacy import with internal id 195
  -> { id: 227010, msp_ticket_number: 195, organization_name: "Contoso" }
# Display number 195 wins. The legacy row is shadowed. No warning.

# Building a prompt, link or message from the internal id.
"Add this to ticket 227010"
# Read as display number 227010 first. Correct only while no ticket in the MSP has that number.

# In platform code: matching both columns by hand.
UPDATE tickets SET deleted_at = now()
 WHERE msp_id = $1 AND (id = $2 OR msp_ticket_number = $2)
# No ORDER BY, no LIMIT: a colliding ref changes BOTH rows while RETURNING reports one.
```

## RIGHT
```
# A number from a person, a URL or the UI is a display number. Pass it as it is.
get_ticket(195)        # or "#195"
  -> { id: 227010, msp_ticket_number: 195, organization_name: "Contoso" }

# Then ASSERT the identity matches what you were asked for, before acting on it.
#   msp_ticket_number == the number in the URL
#   organization_name == the client you expect
#   status/created_at  are plausible for a live request

# Text that a person or an assistant will read back: write the display number.
"Add this to ticket #195"

# In platform code: resolve once to a single row, then act by primary key.
const ticket = await resolveTicketInMsp(db, mspId, ref);   // { id, client_id } | null
UPDATE tickets SET deleted_at = now() WHERE id = $1          -- ticket.id
```

## NOTES
- **A URL number is an `msp_ticket_number`, never an `id`.** `/tickets/<msp-slug>/<N>` always means `msp_ticket_number: N`.
- **The parameter has no id-only form.** `195` and `"#195"` parse to the same reference and take the same path. A legacy import whose internal id equals a live display number cannot be fetched by number through these tools.
- **Fingerprints of the wrong ticket:** an `organization_name` that is not the client you asked about, a `status: "closed"` on what should be a live request, a `created_at` months or years old, or `msp_ticket_number: null` with a non-null `zendesk_ticket_id` when you expected a current ticket.
- **Cross-check before you act, always.** Before touching an endpoint, confirm the ticket's `organization_name`/`client_id` matches the machine's client. An internal note posted to the wrong client's ticket is not retractable.
- The same rule covers every tool taking "id or number" for tickets (`get_ticket_messages`, `list_ticket_attachments`, `add_internal_note`), because they share the resolver.
- **Check which behaviour you are on before trusting either half of this entry.** A fork, an old deployment or a hand-written query may still have the pre-fix ordering. One call with a known colliding number, compared against the dashboard, settles it.
