---
tech: supportforge
tags: [sql, counts, end_users, organizations, requesters, dormant-contacts, is_system_address, undercount, ui-consistency]
severity: high
---
# An organization's "users" count means recent requesters, not members

## PROBLEM
Two SupportForge endpoints report a number labelled *users* for an organization, and neither one counts members. The organizations list computes `total_users` inside a LATERAL, and `GET /organizations/:id/users` returns the org's people. Both wrap the population in a one-year ticket `EXISTS` filter, so both actually mean **"contacts who filed a ticket in the past year."**

A client with 40 contacts reads as 12. Nothing errors and the number is entirely plausible, which is what makes it dangerous: this is the figure staff use to decide whether contacts are missing, so the natural reaction is to go hunting for a broken sync that does not exist.

The same filter is also the default in the browse list (`end-user-list-query.ts`). That is why the count and the list agree with *each other* and both disagree with reality — there is no disagreement to tip you off.

It bites a second time on any new surface. Show true membership somewhere and link it to the users list, and the destination silently shows fewer rows than the number that sent you there, because the destination is still filtering.

## WRONG
```sql
-- Reads as "how many users are in this org". Is actually
-- "how many filed a ticket recently". No error, plausible number.
SELECT COUNT(*) FROM end_users u
 WHERE (u.organization_id::text = c.zendesk_org_id::text OR u.client_id = c.id)
   AND EXISTS (
     SELECT 1 FROM tickets t
      WHERE t.requester_email = u.email
        AND t.created_at >= NOW() - INTERVAL '1 year'
   );
```

## RIGHT
```sql
-- Return both populations and never label either one bare "users".
SELECT
  (SELECT COUNT(*) FROM end_users u
    WHERE (u.organization_id::text = c.zendesk_org_id::text OR u.client_id = c.id)
      AND COALESCE(u.is_system_address, false) = false
  )::integer AS member_count,
  (SELECT COUNT(*) FROM end_users u
    WHERE (u.organization_id::text = c.zendesk_org_id::text OR u.client_id = c.id)
      AND COALESCE(u.is_system_address, false) = false
      AND EXISTS (
        SELECT 1 FROM tickets t
         WHERE t.requester_email = u.email
           AND t.deleted_at IS NULL
           AND t.created_at >= NOW() - INTERVAL '1 year'
      )
  )::integer AS active_requester_count
FROM clients c
WHERE c.id = $1 AND c.msp_id = $2;
```

## NOTES
- Sites carrying the filter: the `user_counts` LATERAL in `GET /organizations` and the `WHERE` in `GET /organizations/:id/users` (both `src/routes/user-org-org-routes.ts`), plus the browse default in `src/services/end-user-list-query.ts`.
- The browse list's version is deliberate and has a deliberate exemption: a search or exact-email lookup skips the filter, because hiding a dormant contact from a targeted lookup reads as "this user does not exist" while create still rejects the address as a duplicate (issues #107, #108). Keep that exemption if you touch it.
- Exclude `is_system_address` rows from either figure. They are auto-flagged no-reply senders, not people, and they inflate membership.
- Cross-surface consistency is the part that bites second. `/settings/users?org=<id>` hides dormant contacts, so a surface showing true membership has to link with `all=1` (API: `?all=true`, which sets `includeDormant`) or its own link contradicts the number it just displayed. Added in supportforge-platform v3.24.0.0.
- Related: `single-key-ticket-aggregates-undercount.md`. These same queries also need the dual-key `OR`, and for the same class of reason — the count runs clean and returns the wrong population.
