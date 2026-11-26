---
tech: aws-ses
tags: [ses, aws-support, production-access, sandbox, cli, SubscriptionRequiredException]
severity: low
---
# The AWS Support API needs a paid support plan, so an SES production-access case cannot be answered from the CLI

## PROBLEM
Requesting SES production access (leaving the sandbox) opens a support case. If AWS replies asking for more information, the natural next step is to read and answer the case from the CLI. `aws support ...` calls fail with `SubscriptionRequiredException` on an account without a paid support plan, even though the case exists and can be seen and answered in the console. Automation, or an agent that drafted the reply, stops at that point.

The account stays in the sandbox (low daily quota, verified recipients only) until a person replies.

## WRONG
```bash
aws support describe-cases --region us-east-1
# An error occurred (SubscriptionRequiredException) when calling the DescribeCases operation:
# AWS Premium Support Subscription is required to use this service.
```

## RIGHT
```text
- Draft the reply text in advance, then have a person paste it into the case in the
  AWS console (Support Center), and record that as a manual step.
- Read case status via SES instead: `aws sesv2 get-account` shows ProductionAccessEnabled
  and the review status/details.
- Do not make production access a prerequisite for work that fits the sandbox.
```

## NOTES
- Writing the first request is possible from the SES side (`aws sesv2 put-account-details`); only reading and replying to the case needs the Support API.
