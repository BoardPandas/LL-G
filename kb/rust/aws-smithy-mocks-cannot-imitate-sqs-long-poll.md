---
tech: rust
tags: [aws-sdk, aws-smithy-mocks, sqs, long-poll, tokio, paused-time, testing, trait-fake]
severity: medium
---
# aws-smithy-mocks cannot imitate an SQS long poll, so timing tests need a trait and a fake on paused time

## PROBLEM
`aws-smithy-mocks` answers every call immediately. A real SQS `ReceiveMessage` with an empty queue blocks for up to the wait time (20 s) before returning. A worker loop written against the real behaviour ("receive; if nothing, loop") therefore spins at full speed under the mock: an idle worker hot-loops, burns the CPU.

It also makes the behaviours that depend on elapsed time untestable: draining on shutdown, visibility-timeout extension, backoff after errors. Using real sleeps makes those tests take minutes and flake.

## WRONG
```rust
// Worker is generic over aws_sdk_sqs::Client; the test uses mock_client!(...)
let client = mock_client!(aws_sdk_sqs, RuleMode::MatchAny, &[&receive_rule]);
// An empty receive returns instantly, forever. No way to say "block 20 s, then empty".
```

## RIGHT
```rust
// A small trait for exactly the calls the worker makes.
pub trait QueueClient: Clone + Send + Sync + 'static {
    fn receive(&self, queue_url: &str, max: i32, wait_s: i32, vis_s: i32)
        -> impl Future<Output = Result<Vec<ReceivedMessage>, QueueError>> + Send;
    fn delete(&self, queue_url: &str, handle: &str)
        -> impl Future<Output = Result<(), QueueError>> + Send;
    fn change_visibility(&self, queue_url: &str, handle: &str, vis_s: i32)
        -> impl Future<Output = Result<(), QueueError>> + Send;
}
// impl QueueClient for aws_sdk_sqs::Client; tests use a scripted in-memory fake that
// returns scripted results in order, then BLOCKS (like an empty long poll) until the
// worker drops the call.

#[tokio::test(start_paused = true)]   // tokio "test-util": a 240 s scenario runs in milliseconds
async fn extends_visibility_during_long_handler() { /* ... */ }
```

## NOTES
- Keep a few tests against `aws-smithy-mocks` for the SDK mapping only (request fields, attributes, error text). Timing behaviour belongs to the fake.
- The fake must block on the empty case rather than return empty; returning empty reproduces the hot loop.
- Paused time needs the tokio `test-util` feature and the current-thread test runtime.
