---
tech: mcp
tags: [mcp, tool timeout, execute_command, long-running, polling, background job, hub]
severity: medium
---
# A hub execute_command call is cut off after about 60-100 seconds

## PROBLEM
An `execute_command` call through an MCP hub is cut off after roughly 60 to 100 seconds, whatever `timeout` argument the caller passes. A long build, install, or scan appears to hang or fail with no result, and a retry repeats the work from the start.

Start long work detached so the call returns at once, write its output and exit status to files, and poll those files in short calls.

## WRONG
```json
{
  "tool": "execute_command",
  "arguments": { "command": "./long-build.sh", "timeout": 900000 }
}
```
The `timeout` argument has no effect past the hub's limit, so the call is cut off mid-run.

## RIGHT
```bash
work_dir=$(mktemp -d)
nohup sh -c "./long-build.sh > '$work_dir/log' 2>&1; echo \$? > '$work_dir/exit'" >/dev/null 2>&1 &
echo "$work_dir"
```
Then poll in short calls: `cat "$work_dir/exit"` returns nothing until the job finishes, and `tail "$work_dir/log"` shows progress.

## NOTES
- Use `mktemp -d` rather than a fixed `/tmp` path, so concurrent runs do not share a log or exit file.
- The exit file is written only when the job finishes, so an empty file read is "still running", not success.
