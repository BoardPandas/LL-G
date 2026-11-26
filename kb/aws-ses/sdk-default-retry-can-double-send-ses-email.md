---
tech: aws-ses
tags: [ses, aws-sdk, retry, idempotency, duplicate-email, timeout, sesv2, rust]
severity: high
---
# The AWS SDK default retry policy can send the same email twice when SendEmail times out after SES accepted it

## PROBLEM
`SendEmail` is not idempotent. The AWS SDKs retry transient failures by default, including timeouts. If the request reaches SES and SES accepts and queues the message, but the response is lost or slow, the client sees a timeout, the SDK retries, and SES accepts a second copy. The recipient gets the message twice, and nothing in your code ran a "send twice" path.

This only shows under real network trouble, so tests and normal runs never reveal it.

## WRONG
```rust
// Client built with the shared SDK config: default retries enabled.
let out = ses.send_email().from_email_address(from).content(content).send().await;
```

## RIGHT
```rust
use aws_sdk_sesv2::config::retry::RetryConfig;

// Exactly one attempt for this call only; other calls keep the shared retry policy.
let sent = request
    .customize()
    .config_override(aws_sdk_sesv2::config::Builder::default().retry_config(RetryConfig::disabled()))
    .send()
    .await;
// On error do NOT resend automatically. Record the attempt as unknown/failed, and
// reconcile from SES events using a message tag you set on the request.
```

## NOTES
- Persist the outbound row before calling SES, and attach a tag (for example the outbound row ID) so the later delivery or bounce event can be matched to a send whose response was never seen.
- Retrying is still fine for idempotent calls (identity lookups, getting account state); disable it per call, not globally.
- After a timeout the message may or may not have been sent. Only the events tell you which; design the state machine for "unknown".
