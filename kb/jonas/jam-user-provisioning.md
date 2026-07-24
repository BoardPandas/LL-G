---
tech: jonas
tags: [jonas, jam, activity-management, club-management, user-provisioning, licensing, pxplus, sync, sql]
severity: high
---
# JAM users provision from Club Management via a manual sync, and a full seat cap greys out New silently

## PROBLEM

Two separate traps stack up behind one symptom: "my ability to add users to Jonas Activity Management seems to be deactivated."

1. **The seat cap fails closed and silently.** JAM is licensed for a fixed number of *active* users. Once every seat is filled, JAM greys out New, Delete and Duplicate on System Administration > Users and locks the Active checkbox. There is no error, no warning, and no tooltip. Save stays enabled, so the user can still edit existing records, which makes it read like a permissions problem rather than a licensing one. Checking module security is a dead end: the account has Full Access and nothing has changed.

2. **JAM users do not originate in JAM.** They are created in Jonas Club Management (the PxPlus app) by ticking Activity Management on the user, then pulled into JAM's SQL database by an import that is **manual and unscheduled**. Nothing carries the change across on its own. There is no scheduled task, and the integration job queue stays empty. So Club Management edits save correctly and verifiably, while JAM keeps showing stale data indefinitely, which looks like the edits silently failed.

Combined effect: a technician confirms the Club Management change is on disk, confirms JAM is unchanged, and concludes the write was lost or went to the wrong database.

## WRONG

```sql
/* Symptom: New / Delete / Duplicate greyed out, Active checkbox locked, NO error. */

/* Wrong assumption 1: it is a permissions problem.
   Module security shows the user's group with Full Access to Users,
   User Groups and Module Security. Not the cause. */

/* Wrong assumption 2: create the user in JAM.
   System Administration > Users > New  ... button is greyed out,
   and this is not where JAM users originate anyway. */

/* Wrong assumption 3: bypass the UI and insert into SQL. */
INSERT INTO tblPvxUsers (UserName, FirstName, LastName, UserGroupID, IsActive)
VALUES ('ASHLEE', 'Ashlee', 'Lynch', 1, 1);
/* Passwords are application-encrypted, so a hand-inserted user cannot log in. */

/* Wrong assumption 4: the Club Management edit did not save,
   or it went to the wrong SQL instance.
   It saved fine. Nothing is scheduled to carry it across. */
```

## RIGHT

```sql
/* 1. Check the seat cap first, since that is what greys out New/Delete.
      JAM > System Administration > Activation > Current Applications
      shows installed modules and their user license counts. */
SELECT COUNT(*) AS Total,
       SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS Active,
       SUM(CASE WHEN IsActive = 0 THEN 1 ELSE 0 END) AS Inactive
FROM tblPvxUsers;
/* Active equal to the licensed count means New is disabled with no message. */

/* 2. Free seats in JONAS CLUB MANAGEMENT, not JAM:
      untick Activity Management on departing users.
   3. Provision the new user in CLUB MANAGEMENT: tick Activity Management.
   4. RUN THE IMPORT. It is manual and has no schedule:
      JAM > System Administration > Integration
        verify "Jonas Main Path" points at <drive>:\JONAS\GJCWIN\DATA
        click the GEAR icon to start the import
   5. Verify it landed. */
SELECT UserName, FirstName, LastName, UserGroupID, IsActive, LEN(Password) AS PwLen
FROM tblPvxUsers
WHERE UserName = 'ASHLEE';
/* A synced user has an encrypted password of the same length as a working
   peer account. That is the tell that the record is usable, not a stub. */
```

## NOTES

- `tblPvxUsers` ("Pvx" is PxPlus) is a **mirror** of the Club Management user list, filtered to users flagged for Activity Management. Club Management holds many more users than JAM does, so a name existing there does not mean it exists in JAM.
- **Confirm which SQL instance JAM uses before querying or writing.** Read `HKLM\SOFTWARE\WOW6432Node\JonasNET` and use `WCF_IPAddress` plus `DBName`. These servers commonly carry a second, stale `JonasNET` on the default `MSSQLSERVER` instance that accepts writes with no error while JAM never reads it. Cross-check by comparing the user list against what the JAM UI shows.
- Club Management user keys in `GJCWIN\DATA\GJUSERS` are **space-padded to fixed width**: numeric IDs are stored as `usr␣␣␣␣␣857`, names as `usrASHLEE␣␣`. Searching the file for `usr857` returns nothing and wrongly suggests the account is JAM-only.
- The Integration screen's documented Options cover member and guest synchronization; users ride along with the same gear import.
- Imported users leave **no entry in `tblSystemRecordUpdates`**. That table logs interactive edits only, so JAM's audit history shows nothing for synced accounts and looks untouched.
- `GJCWIN\DATA\GJUSERS` is a flat PxPlus file that SQL backup jobs do not cover. Check that it is backed up separately before treating the environment as protected.
- Help source on the server: `GJCWIN\TOOLS\Jonas.NET\JAMHelp\System_Administration\System_Setups\Users.htm` and `IntegrationJAM.htm`, plus `Tasks\Activation.htm`.
