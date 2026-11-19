---
tech: entra-external-id
tags: [entra-external-id, graph-api, b2b, usertype, guest, admin, directory-role]
severity: high
---
# Invited admin accounts in an external tenant can be userType Member, so a Guest check misses them

## PROBLEM
A rule meant to exclude administrators ("refuse any `userType` `Guest`") assumes every invited
admin in an External ID tenant is a guest. Invited accounts can carry `userType` `Member`
(`creationType` `Invitation`, a federated `ExternalAzureAD` identity), so the rule silently
lets them through. Nothing errors; the check just never matches.

## WRONG
```js
const user = await graph(`/users/${id}?$select=userType`);
if (user.userType === 'Guest') return refuse('admin'); // invited Global Admins are 'Member'
```

## RIGHT
```js
// Read memberships without the group cast and fail closed on anything that is not a group:
// active directory roles appear as #microsoft.graph.directoryRole.
const items = await pagedGet(`/users/${id}/transitiveMemberOf?$select=id,displayName`);
if (items.some((m) => m['@odata.type'] !== '#microsoft.graph.group')) return refuse('role');
if (user.userType === 'Guest') return refuse('guest'); // keep, as a second rule
```

## NOTES
Before relying on any `userType` rule, list `/roleManagement/directory/roleAssignments` with the
principals and check their actual `userType`. `transitiveMemberOf` does not show eligible (PIM)
or administrative-unit-scoped roles; without Entra ID P2 there are no eligible roles at all.
