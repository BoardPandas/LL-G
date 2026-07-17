---
tech: supportforge
tags: [tickets, mcp, ticket-number, id-collision, cross-client, silent-wrong-output, identifiers]
severity: high
---
# get_ticket(N) resolves the internal id before the MSP number and can return a different client's ticket

## PROBLEM
`get_ticket` accepts "ticket id or MSP ticket number" for the same parameter. When both interpretations exist, it resolves the **internal `id`** and never tells you it made a choice.

The two namespaces overlap badly:
- `msp_ticket_number` is the number in the dashboard URL (`/tickets/wellforce/195`) and is a **small integer** (87, 111, 177, 195 ...).
- `id` is the internal primary key. Modern rows are large (226813, 227010), but **legacy Zendesk-imported rows have small ids in the exact same range**, with `msp_ticket_number: null`.

So `get_ticket(195)` returns internal id 195 -- a closed Capitol Hill Club ticket from 2025 about a stuck Win+P dropdown -- when the operator meant `/tickets/wellforce/195`, which is "Noelle's Computer" at Belle Haven (id 227010).

Nothing errors. You get a well-formed ticket for **the wrong client**. In an MSP context that is both a cross-tenant data exposure and a live remediation hazard: act on it and you are troubleshooting the wrong machine at the wrong company. The only reason it was caught was that the hostname in the request contradicted the organization on the returned ticket.

## WRONG
```
get_ticket(195)
  -> { id: 195, msp_ticket_number: null, zendesk_ticket_id: "9654",
       organization_name: "Capitol Hill Club", status: "closed",
       subject: "The lobby slideshow is playing but on the right of" }
# Operator meant /tickets/wellforce/195. Different client. Different year. No warning.
```

## RIGHT
```
# Resolve the display number to an internal id first, then fetch by that id.
list_tickets(search: "#195")
  -> { id: 227010, msp_ticket_number: 195, display_number: "195",
       organization_name: "Bellehaven Country Club (BHCC)" }

get_ticket(227010)     # unambiguous: internal id

# Then ASSERT the identity matches what you were asked for, before acting on it.
#   msp_ticket_number == the number in the URL
#   organization_name == the client you expect
#   status/created_at  are plausible for a live request
```

## NOTES
- **A URL number is an `msp_ticket_number`, never an `id`.** `/tickets/<msp>/<N>` always means `msp_ticket_number: N`. Treat any bare number a human gives you as the display number and resolve it via `list_tickets(search:"#N")`.
- **Fingerprints of a wrong resolution:** `msp_ticket_number: null` (real ones always have it), a non-null `zendesk_ticket_id`, a `status: "closed"` on what should be a live request, a `created_at` months or years old, or an `organization_name` that is not the client you asked about. Any one of these means you got a legacy import, not the ticket you wanted.
- **Cross-check before you act, always.** Before touching an endpoint, confirm the ticket's `organization_name`/`client_id` matches the machine's client. Here `BH-W10-NHINKLE` is Bellehaven while the returned ticket was Capitol Hill Club -- that contradiction was the only signal.
- The same ambiguity applies to any tool taking "id or number" for tickets (`get_ticket_messages`, `list_ticket_attachments`, `add_internal_note`). Pass the resolved internal id to all of them; an internal note posted to the wrong client's ticket is not retractable.
- Collision space is wide, not a rare edge: every `msp_ticket_number` below the highest legacy imported id is a potential hit.
