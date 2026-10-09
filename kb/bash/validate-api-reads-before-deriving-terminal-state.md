---
tech: bash
tags: [bash, jq, api, retries, automation, destructive-actions, fail-closed]
severity: high
---
# Validate API reads before deriving terminal state

## PROBLEM

A transient API failure can produce an empty or malformed response without producing a usable state object. This is easy to miss in Bash because jq exits successfully when it receives no input and prints nothing, while an empty variable in a numeric `[[ ... -eq 0 ]]` test is treated as zero. A monitor can therefore turn "I could not observe the queue" into "the queue has no work remaining" and run destructive completion or cleanup actions.

An `ERR` trap that performs cleanup is not a substitute for validating observations. Depending on the command context and the trap's return status, execution may continue after the trap; the same empty variables can still reach the terminal-state branch.

## WRONG

```bash
set -Eeuo pipefail
trap cleanup ERR

queue=$(api_get /jobs)
summary=$(jq '{remaining: ([.jobs[].remaining] | add // 0)}' <<<"$queue")
remaining=$(jq -r '.remaining' <<<"$summary")

if [[ "$remaining" -eq 0 ]]; then
  cancel_guard
  cleanup
fi
```

## RIGHT

```bash
if ! queue=$(api_get /jobs); then
  sleep 5
  continue
fi

if ! summary=$(jq -ce '
  select(type == "object" and (.jobs | type == "array"))
  | {remaining: ([.jobs[].remaining] | add)}
' <<<"$queue"); then
  sleep 5
  continue
fi

if ! remaining=$(jq -er '
  .remaining | select(type == "number" and . >= 0)
' <<<"$summary"); then
  sleep 5
  continue
fi

if (( remaining == 0 )); then
  complete_only_after_independent_verification
fi
```

## NOTES

Treat observation failure as unknown state: retry without mutating anything. Validate both the response shape and the required field types before arithmetic. For high-impact completion, cancellation, or deletion, independently re-read the terminal condition before acting. If an `ERR` trap must terminate the process, make that termination explicit; do not rely on the trap to imply an exit.
