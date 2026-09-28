---
tech: gemini
tags: [files-api, resumable-upload, cleanup, resource-ownership, transport-errors, privacy]
severity: high
---
# Allocate a file name before upload so a lost finalize reply cannot hide cleanup ownership

## PROBLEM

A resumable upload can finish on the provider while its final response is lost,
invalid JSON, or missing metadata. If cleanup is installed only after parsing
that response, the client has already sent the audio but never learned the
resource name needed for deletion. Returning an upload error or preserving the
local transcript does not remove the remote file.

Gemini's File resource accepts a caller-chosen name on creation. Waiting for a
server-generated name unnecessarily couples cleanup ownership to a successful
response. This is a failure-path design issue, not evidence that every upload
error means a file exists.

## WRONG

```text
start resumable upload without a name
send audio with "upload, finalize"
parse response JSON                 # may fail after the bytes were accepted
name = response.file.name
install cleanup(name)               # never reached on that failure
transcribe()
delete(name)
```

## RIGHT

```text
name = new_unique_non_sensitive_name()
start resumable upload with file.name = name
validate the returned upload destination
install cleanup(name) BEFORE sending the first audio byte

result = attempt:
  send audio with "upload, finalize"
  parse the response and require returned file.name == name
  wait for processing with a real overall deadline
  transcribe()

attempt DELETE of the known owned name on success and failure
surface cleanup failure; retain a bounded best-effort teardown retry
return result only after accounting for cleanup
```

## NOTES

- The [File resource reference](https://ai.google.dev/api/files#File) permits a
  supplied name. Its ID has at most 40 lowercase letters, digits, or dashes and
  cannot begin or end with a dash. Generate an identity independent of filenames,
  meeting titles, or transcript content. Prevent collisions before treating the
  name as owned.
- Delete only the name allocated for this upload. An unexpected name in a
  response is a protocol/ownership failure, not permission to delete that other
  resource. Preserve the distinction between an accepted DELETE, a failed DELETE,
  and a response saying the resource was absent at that moment.
- Knowing the name makes a cleanup attempt possible; it does not guarantee
  deletion after a hard process kill, network outage, or an in-flight finalization
  that completes after an early cleanup request. Stronger guarantees need durable
  cleanup records and reconciliation. Provider expiry is a fallback, not proof of
  immediate deletion.
- Hark added mock transport cases for successful inference, provider/parse
  failures, malformed or missing finalize metadata, a dropped finalize reply,
  and an unexpected returned name. These exercise request ordering and cleanup
  ownership; they do not validate live Gemini service behavior.
- The [long-audio lesson](long-audio-early-stop.md) already covers windowing,
  channel identity, coverage, and deleting uploads after use. This entry adds the
  cleanup-ownership gap before a valid finalize response exists.

Hark source and regression tests: [meeting_gemini.rs](https://github.com/BoardPandas/Hark/blob/7cbdc2341914cabcc8260b870a795c8793e76e48/crates/hark-stt/src/meeting_gemini.rs).
