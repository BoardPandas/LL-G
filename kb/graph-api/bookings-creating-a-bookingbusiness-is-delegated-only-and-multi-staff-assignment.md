---
tech: graph-api
tags: [bookings, bookingBusiness, app-only, permissions, bookingService]
severity: medium
---
# Bookings: creating a bookingBusiness is delegated-only, and multi-staff assignment is not in Graph

## PROBLEM
App-only Graph cannot create a Microsoft Bookings page: POST /solutions/bookingBusinesses supports only delegated Bookings.Manage.All, and the Bookings UI setting "Assign all of your selected staff" has no Graph property at all.
Granting Bookings.Manage.All as an application permission looks like it should cover everything, because it does cover services, staff and publish. Creation still fails app-only, and the setting that books every selected staff member onto one appointment can only be set in the Bookings web UI. bookingService (v1.0 and beta) has only staffMemberIds, which lists who can be booked, not who gets booked together.

## WRONG
```http
# app-only token with Bookings.Manage.All (application)
POST https://graph.microsoft.com/v1.0/solutions/bookingBusinesses
{ "displayName": "New Member Orientation" }
# -> refused: Application permission "Not supported" for this API

PATCH .../bookingBusinesses/{id}/services/{serviceId}
{ "staffMemberIds": ["<staff1>", "<staff2>"] }
# -> succeeds, but each booking still goes to ONE staff member
```

## RIGHT
```http
# 1. Create the page delegated (signed-in user, Bookings.Manage.All), or in the Bookings web UI.
# 2. Set "Assign all of your selected staff" in the Bookings web UI (not in Graph).
# 3. Then app-only works for the rest:
POST .../bookingBusinesses/{id}/staffMembers      # Bookings.ReadWrite.All
POST .../bookingBusinesses/{id}/services          # Bookings.ReadWrite.All
POST .../bookingBusinesses/{id}/publish           # Bookings.Manage.All (application)
```

## NOTES
- Least-privileged application roles: Bookings.Read.All (read), Bookings.ReadWrite.All (services, staff), Bookings.Manage.All (publish). Manage.All is a superset.
- A new app role takes 1 to 15 minutes to reach a token; GET /solutions/bookingBusinesses keeps returning 403 "Forbidden Access" until then.
- Check the tenant switch with Exchange Get-OrganizationConfig BookingsEnabled before assuming Bookings is available.
- Related: "New permissions take 1-15 min to propagate", "403 = missing admin consent, not missing permission".
