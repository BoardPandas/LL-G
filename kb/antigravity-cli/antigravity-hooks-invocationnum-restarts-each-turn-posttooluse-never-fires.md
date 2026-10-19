---
tech: antigravity-cli
tags: [agy, hooks, invocationnum, posttooluse, sessionstart, injectsteps, ephemeralmessage, systemmessage]
severity: high
---
# Antigravity hooks: invocationNum restarts each turn, PostToolUse never fires

## PROBLEM
In Antigravity CLI (`agy` 1.3.5) hooks, `invocationNum` restarts at 0 every turn, PostToolUse never fires, and a SessionStart `ephemeralMessage` lasts one model call. Each silently breaks a hook adapter written from the event names alone.
- `invocationNum` restarts at 0 on every turn: 0, 1 on the first prompt, then 0, 1, 2 on the next. It is on PreInvocation and PostInvocation. `invocationNum == 0` marks a new prompt, not a new session, so start-up work keyed on it runs again on every prompt. SessionStart is the session event. It fires once per new conversation, and not again on `agy -c`.
- PostToolUse never fired in five tool calls (`run_command`, `view_file`), with a PostToolUse hook installed. Anything hung on it, such as a heartbeat or context added after a tool call, never runs. PreToolUse and PreInvocation do fire.
- On SessionStart, an `{"injectSteps":[{"ephemeralMessage":"..."}]}` reaches only the turn's first model call. Asked after a tool call, the model no longer had it.

## WRONG
```bash
case $event in
  SessionStart)
    jq -nc --arg m "$context" '{injectSteps: [{ephemeralMessage: $m}]}' ;;  # gone after one model call
  PreInvocation)
    [ "$(jq -r .invocationNum <<<"$payload")" = 0 ] && start_session         # runs on every prompt
    printf '{}' ;;
  PostToolUse)
    after_tool; printf '{}' ;;                                                 # never runs
esac
```

## RIGHT
```bash
case $event in
  SessionStart)    # once per conversation: start the session here
    start_session
    printf '{}' ;;
  PreInvocation)   # before every model call, tool steps included
    if [ "$(jq -r .invocationNum <<<"$payload")" = 0 ]; then on_prompt; else after_tool; fi
    jq -nc --arg m "$context" '{injectSteps: [{ephemeralMessage: $m}]}' ;;
  *) printf '{}' ;;
esac
```
- Key the session on the payload's `conversationId`, which stays the same across `agy -c`.
- Treat a PreInvocation with `invocationNum > 0` as "a tool step just happened", in place of PostToolUse.
- Put what every model call must see in a PreInvocation `ephemeralMessage`. PreInvocation runs before each call, and its ephemeral step reached the model after a tool call too.

## NOTES
- Captured on `agy` 1.3.5, with hooks in `~/.gemini/config/hooks.json`. The runs were headless: `agy -p ... --dangerously-skip-permissions </dev/null`, then `agy -c -p ...`.
- A hook must print valid JSON with known keys, so print `{}` when there is nothing to say. Hooks run through `sh -c` with the folder holding `hooks.json` as their working directory, so a relative script path resolves there. `ANTIGRAVITY_CONVERSATION_ID` is in a hook's environment.
- There is no session-end event. Stop fires at the end of every turn (`terminationReason`, `fullyIdle`), so end sessions on inactivity.
- PostInvocation carries the same fields as PreInvocation and no model output.
- A `systemMessage` step (`{"systemMessage":{"systemMessage":"..."}}`) or a `userMessage` step returned from SessionStart also reached the model. Whether either outlasts the first model call was not probed. Test it with a question asked after a tool call before relying on it in place of PreInvocation.
- Re-check PostToolUse on each new release before relying on it.
