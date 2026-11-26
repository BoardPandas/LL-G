---
tech: aws-ses
tags: [ses, domain-identity, dkim, easy-dkim, verification, dns, pending]
severity: medium
---
# A new SES domain identity can stay PENDING for hours after the DNS records are correct

## PROBLEM
You create a domain identity, publish the Easy DKIM CNAMEs, and the records resolve correctly, yet the identity stays `PENDING`. SES checks DNS shortly after creation and then backs off; if the records were not yet published at the early checks, the next check can be many hours away. In one run an identity was still `PENDING` more than five hours after correct DNS existed. Waiting did not help within that time.

## WRONG
```bash
# Create identity, then publish DNS some minutes later, then poll.
aws sesv2 create-email-identity --email-identity example.com
# ... add the DKIM CNAMEs ...
while ! aws sesv2 get-email-identity --email-identity example.com \
      --query 'VerifiedForSendingStatus' --output text | grep -q True; do sleep 600; done
# Can loop for hours.
```

## RIGHT
```bash
# Confirm DNS first, then delete and re-create the identity to force an immediate re-check.
dig +short CNAME <token>._domainkey.example.com          # must return the SES target
aws sesv2 delete-email-identity --email-identity example.com
aws sesv2 create-email-identity --email-identity example.com
# Easy DKIM returned the same three tokens, so the existing CNAMEs stay valid.
# Verification completed in under a minute.
```

## NOTES
- Re-creating the identity also removes its configuration (configuration-set association, MAIL FROM domain, feedback settings, policies). Re-apply them after, and do this before production traffic depends on the identity.
- The same tokens came back on re-creation in the observed case. Compare the new tokens with your DNS before assuming they did.
- Better ordering avoids the problem: publish DNS first, then create the identity.
