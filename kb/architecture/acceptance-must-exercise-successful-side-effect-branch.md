---
tech: architecture
tags: [acceptance-testing, end-to-end, user-interface, rpc, resource-lifecycle]
severity: high
---
# Acceptance must exercise the successful side-effect branch

## PROBLEM
A workflow can pass contract tests and native acceptance when the matrix checks only preparation, cancellation, and a successful RPC response. The untested confirmation branch may return a valid resource identifier while the client discards it, keeps its destination UI hidden, or never wires the resource's output and input lifecycle. The acceptance report is then green even though the first real use appears to do nothing.

## WRONG
```text
preview = prepare_action()
assert preview.is_visible()
cancel(preview)
assert preview.is_closed()

result = launch_action()
assert result.is_ok()
mark_feature_accepted()
```

## RIGHT
```text
preview = prepare_action()
resource_id = confirm(preview)

assert destination_surface.is_visible()
assert destination_surface.is_focused()
assert destination_surface.is_bound_to(resource_id)
assert attach(resource_id).shows_expected_output()

type_into(destination_surface, "probe")
assert backend_received_input(resource_id, "probe")

close(resource_id)
reopen_destination_surface()
assert lifecycle_state_is_explicit()
```

## NOTES
For resources created on another node, also prove that the returned identifier is registered with its owner before attach, input, resize, or close. Preserve the valid evidence from the old matrix, but reopen the overall gate when a required success branch was omitted.

