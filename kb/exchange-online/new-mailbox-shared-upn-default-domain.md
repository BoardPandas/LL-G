---
tech: exchange-online
tags: [shared-mailbox, upn, new-mailbox, provisioning, multi-domain, entra, mailbox-conversion]
severity: high
---
# New-Mailbox -Shared sets the UPN to the tenant default domain, not the primary SMTP domain

## PROBLEM

`New-Mailbox -Shared -PrimarySmtpAddress grants@neuroamerica.org` creates the mailbox with
exactly the primary SMTP address you asked for, but the underlying Entra user object gets its
`userPrincipalName` from the tenant's **default accepted domain**, ignoring the domain in
`-PrimarySmtpAddress`.

Nothing looks wrong. `Get-Mailbox` reports the correct `PrimarySmtpAddress`, the Microsoft 365
admin center shows the correct email address, and mail flows correctly in and out. The
`proxyAddresses` collection is correct too. The only wrong field is the sign-in name, and it is
not one anybody reads on a shared mailbox, because shared mailboxes have sign-in blocked and
nobody ever logs into one.

It surfaces much later, on conversion to a licensed sign-in account (`Set-Mailbox -Type Regular`).
That conversion is a routine move: Exchange Online cannot delegate a mailbox to a security
principal that does not exist in the tenant, so when an external collaborator needs access, the
shared mailbox has to become a real account they can sign into. At that moment the person is
handed a login on the wrong domain.

This bites hardest in a tenant hosting many domains, which is the normal shape for association
management companies, nonprofit umbrellas, and MSP-consolidated tenants. In a tenant with 21
verified domains, a contractor hired by one subsidiary ends up signing in as
`grants@parentcompany.com` to work a different organization's mail. That is confusing to the
user, wrong on the audit trail, and needlessly discloses the parent tenant's domain to an
outsider.

## WRONG

```powershell
New-Mailbox -Shared -Name 'Grants' -DisplayName 'Grants' -Alias grants `
    -PrimarySmtpAddress grants@neuroamerica.org

# Everything you would normally check agrees:
#   PrimarySmtpAddress : grants@neuroamerica.org        <-- correct
#   proxyAddresses     : SMTP:grants@neuroamerica.org   <-- correct
#
# But the Entra object silently holds:
#   userPrincipalName  : grants@woodberryassociates.com <-- tenant DEFAULT domain

# Weeks later, the mailbox needs to become a sign-in account for a freelancer:
Set-Mailbox -Identity grants@neuroamerica.org -Type Regular
# No error. The external user is now told to sign in as grants@woodberryassociates.com.
```

## RIGHT

```powershell
New-Mailbox -Shared -Name 'Grants' -DisplayName 'Grants' -Alias grants `
    -PrimarySmtpAddress grants@neuroamerica.org

# The SMTP address and the sign-in name are populated from different sources.
# Never infer one from the other -- compare them explicitly.
$mbx = Get-Mailbox -Identity grants@neuroamerica.org
if ($mbx.UserPrincipalName -ne $mbx.PrimarySmtpAddress) {
    Write-Warning "UPN $($mbx.UserPrincipalName) does not match SMTP $($mbx.PrimarySmtpAddress)"

    # Entra owns the sign-in name. Fix it there, not in EXO.
    # Equivalent to: PATCH /users/{id} { "userPrincipalName": "..." }
    Update-MgUser -UserId $mbx.ExternalDirectoryObjectId `
        -UserPrincipalName $mbx.PrimarySmtpAddress
}
```

## NOTES

- Only applies in a tenant with more than one accepted domain. The domain that wins is whichever
  `Get-AcceptedDomain | Where-Object { $_.Default }` returns, not the one in the SMTP address.
- Fix it at creation time. Changing a UPN after someone has signed in means re-teaching them the
  login, and can invalidate cached credentials and Outlook profiles.
- The reason you end up converting at all is worth knowing: a B2B guest cannot be given usable
  `FullAccess` to an Exchange Online mailbox. Guests have no Exchange mailbox, so
  `Add-MailboxPermission` against one can appear to apply and then do nothing, and Outlook/OWA
  will not open the mailbox for them. A licensed member account is the only supported path for an
  external collaborator, which is exactly what forces the shared-to-regular conversion.
- On the conversion itself: existing `FullAccess` and `SendAs` grants survive `Set-Mailbox -Type
  Regular`, and `usageLocation` must be set before `assignLicense` or the license call fails.
- Related: EXO reads are replica-inconsistent, so poll after the conversion rather than asserting
  on a single read. See `exo-membership-reads-replica-inconsistent.md`.
