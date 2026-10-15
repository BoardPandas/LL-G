---
tech: architecture
tags: [error-handling, observability, reason-codes, exception-chains, privacy, bounds, failure-isolation, finalization]
severity: high
---
# Public reason normalization must not erase private failure evidence

## PROBLEM

A component reports a failure by concatenating a stable code and an exception class, such as `observer_error:IllegalArgumentException`. A later public-status normalizer permits only lowercase letters and underscores, so it replaces the entire value with `capture_stopped`. If the original exception was discarded, a safety measure that correctly restricts public output has also erased the only evidence of the root failure.

The process can still return a valid workload result, leaving a partial recording and a generic reason. Raising log verbosity later cannot recover an exception that was never retained. Loosening the public grammar or printing the exception to stdout is not a safe repair: exception messages and stack traces can contain sensitive data, and status consumers need stable machine-readable codes.

## WRONG

```java
catch (RuntimeException failure) {
    stopRecorder("observer_error:" + failure.getClass().getSimpleName());
    // The Throwable is discarded here.
}

String publicReason(String reason) {
    return reason.matches("[a-z][a-z0-9_]{0,63}")
            ? reason : "capture_stopped";
}
```

Another wrong repair serializes the entire exception into the public receipt or logs it when private persistence fails. That trades missing evidence for an unintended disclosure.

## RIGHT

Carry two explicit channels through every wrapper: a stable public code and a bounded private exception projection. Do not derive the code by parsing human-readable exception text. Validate codes as strings before applying the grammar; some runtimes coerce arrays or other values during regular-expression checks.

```text
onRecorderFailure(stableCode, failure):
    rethrowFatalAccordingToRuntimePolicy(failure)
    code = validatePublicCode(stableCode)

    under the recorder terminal-state gate:
        if captureIsSealed or firstStopReason already exists:
            return
        try:
            privateFailure = boundedExceptionProjection(failure)
        catch reportingFailure:
            rethrowFatalAccordingToRuntimePolicy(reportingFailure)
            privateFailure = {unavailable: "exception_capture_failed"}
        finally:
            stopRecorderOnly(code)

publicReceipt = allowlisted status, code, counts and timestamps
privateManifest = public metadata plus the validated privateFailure projection
```

The gate makes the first stopping reason authoritative and prevents the writer from sealing its final manifest before the matching bounded projection is ready. Keep disk I/O and potentially unbounded work off the workload thread. Later cleanup or reporting failures must not replace an earlier quota, lease or recorder stop, fabricate completion, or overwrite the primary workload's result. A callback failure should disconnect passive recording and allow the primary operation to continue; explicitly preserve the runtime's policy for fatal errors and thread termination.

The private projection is an explicit schema, not arbitrary object serialization. A verified profile allowed at most **8 causes, 16 stack frames per cause, 64 frames total, 1,024 message characters per cause and 24 KiB of encoded exception JSON**. It bounded text before copying, detected cause cycles, recorded truncation and unavailable fields, and excluded environment, locals, suppressed-exception graphs and arbitrary object fields. Bound escaped JSON bytes as well as character counts. Accessors and even failure reporting can throw; retain a bounded unavailable marker without allowing a secondary nonfatal error to interrupt the workload.

Treat messages and frames as sensitive even inside that projection. Keep them only in access-controlled artifacts with the existing retention policy. Public status, receipts, stdout, ordinary logs, audit payloads and fallback error responses must use explicit allowlists that exclude the private field. Validate the projection again when another process reconciles or exports it; reject extra fields and malformed or oversized values, and never label a recording complete when it contains recorder-failure evidence.

Keep the terminal boundary durable. Progress already queued before finalization must recheck whether updates are allowed **when it acquires the mutation lock**. A check only when the callback arrives still permits delayed progress to overwrite a settled receipt. Public failure-code changes must also update lifecycle consumers, such as retention classification, so the same fault still closes shared references at the proven writer-stop boundary.

## NOTES

- The verified correction passed **68 recorder-failure assertions**, **49 exception-bound assertions**, **119 observer-isolation assertions** and **121 wrapper tests**. Cases included original cause forwarding, mixed-case legacy class suffixes, hostile accessors, cause/message/frame bounds, first-reason precedence, private-archive retention, public-output non-disclosure and late or queued progress after settlement.
- Preserve a safe generic public fallback when the private projection cannot be obtained. Do not claim an unavailable historical exception was recovered merely because a later controlled reproduction matches its failure boundary.
- Add a distinctive synthetic private marker to tests. Assert that it survives the authorized artifact path and is absent from every public receipt, summary and stdout path. Test reporting failure as well as the initial recorder failure.
- Related: [Exception text can contain URL secrets](../python/requests-exception-leaks-url-secrets.md). Keeping evidence requires a protected channel; printing the exception broadly is not equivalent.
