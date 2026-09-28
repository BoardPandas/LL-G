---
tech: bash
tags: [bash, gh, pull-request, markdown, command-substitution, quoting, shell-injection]
severity: high
---
# Markdown backticks in a double-quoted gh body execute shell commands

## PROBLEM

Building a shell command that places a Markdown pull-request body directly inside
double quotes lets Bash interpret every Markdown backtick as command substitution.
The commands run locally, their stdout replaces the code spans, and `gh pr create`
can still exit 0 after publishing the corrupted body. This is especially easy to
miss when JavaScript `JSON.stringify()` is used to quote a command argument: JSON
quoting is not shell escaping, and the resulting outer double quotes still enable
Bash command substitution. A verification list such as `` `pnpm verify` `` can
therefore run the suite unexpectedly; a more dangerous code span could mutate data.

## WRONG

```bash
# Bash executes pnpm verify and substitutes its stdout into the PR body.
gh pr create --body "## Verification

- `pnpm verify`"
```

```javascript
// JSON.stringify() produces a double-quoted shell fragment, not a shell-safe argv.
const command = "gh pr create --body " + JSON.stringify(markdownBody);
await exec(command);
```

## RIGHT

```bash
# Write Markdown with a file-writing API, then pass only the filename through Bash.
gh pr create --body-file /path/to/pr-body.md

# Read the stored body back from GitHub before trusting the write.
gh pr view 302 --json body --jq .body
```

When an execution API supports an argv array without a shell, pass the body as one
argv element through that API. Otherwise prefer `--body-file`; it avoids shell
parsing regardless of Markdown content and scales beyond command-line length limits.

## NOTES

- A successful `gh pr create` exit code proves that a PR was created, not that its
  body survived shell parsing.
- Backticks expanded from an already-quoted shell variable are not re-evaluated.
  The bug occurs when literal backticks are present in the command text Bash parses.
- Verify the resulting body with `gh pr view` and repair it with `gh pr edit
  --body-file` if needed.
- This is a Bash quoting gotcha, not a repository configuration defect, so it does
  not need a Claude or Codex eval case.
