---
tech: aws-ses
tags: [ses, sns, sqs, event-destination, dead-letter-queue, configuration-set, receipt-rule, json]
severity: medium
---
# SES publishes non-event setup messages that a JSON-only consumer sends to the dead-letter queue

## PROBLEM
Two SES setup actions put messages on your topic that are not the events you built the consumer for:

1. Creating a configuration-set event destination that publishes to SNS makes SES publish one plain-text message, "Successfully validated SNS topic for Amazon SES event publishing.", to the topic. It is not JSON and never will parse as an event.
2. Reported, but not independently verified here: the inbound receipt rule can emit a `Received` notification whose `messageId` is `AMAZON_SES_SETUP_NOTIFICATION`, which is a setup probe rather than a real message and has no stored raw object.

A consumer that parses every body as JSON (or looks every ID up) fails on these, the SQS queue redelivers them, and they end up in the dead-letter queue until the redrive limit is reached. Alarms on the DLQ fire for a healthy new stack.

## WRONG
```text
body = "Successfully validated SNS topic for Amazon SES event publishing."
handler: serde_json::from_str(body)?   // error -> message retried -> DLQ
```

## RIGHT
```text
// Recognise the known setup body and delete the message instead of retrying it.
if body.starts_with("Successfully validated SNS topic") {
    return Ok(Delete);     // not an event; never retry, never dead-letter
}
// Likewise skip a Received notification whose messageId is AMAZON_SES_SETUP_NOTIFICATION.
// Everything else that fails to parse still goes to the DLQ.
```

## NOTES
- Match a narrow prefix, not "any non-JSON body": genuinely malformed messages should still reach the DLQ where someone sees them.
- The setup message is published once when the destination is created, so it is easy to dismiss as a one-off.
