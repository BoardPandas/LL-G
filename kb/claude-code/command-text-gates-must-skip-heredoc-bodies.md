---
tech: claude-code
tags: [hooks, bash, heredoc, false-positive]
severity: medium
---
# Command-text gates must skip heredoc bodies

## PROBLEM
A PreToolUse gate on Bash that blocks production deploys (or pushes, or sends) usually works on the command TEXT: collapse the quoted regions so `echo "wrangler deploy"` is not mistaken for a deploy, then substring-match the rest. That correctly ignores quoted mentions, but a **heredoc body is not quoted**. It is input to a command, never a command, yet the gate scans it as if it were.

So writing a file whose content merely mentions a deploy tool -- a reference doc listing CLIs, a runbook, a Python script piped through `python - <<'PY'` -- is refused as a production deploy. The session then reaches for workarounds (splitting words, base64, disabling the hook), each worse than the false positive. The failure is loud but misattributed: the refusal names a deploy the command never runs.

The fix has a dangerous direction. A heredoc detected where there is none hides every line after it from the gate, which turns a false positive into a silent bypass. The stripper has to be exact about where `<<` really starts a heredoc.

## WRONG
```bash
CMD=$(jq -r '.tool_input.command // empty')
SCAN=$(printf '%s' "$CMD" | sed -e "s/'[^']*'/__Q__/g" -e 's/"[^"]*"/__Q__/g' | tr '\n' ';')
case "$SCAN" in
  *wrangler*deploy*) echo "BLOCKED: production deploy needs release authorisation" >&2; exit 2 ;;
esac

# Blocked, although nothing is deployed -- the body is file content:
#   cat > docs/tools.md <<'EOF'
#   | wrangler | Cloudflare CLI | run wrangler deploy from CI only |
#   EOF
```

## RIGHT
```bash
# Drop heredoc bodies BEFORE collapsing quotes and matching. The operator (<<, <<-, with a bare,
# 'quoted', "quoted" or \escaped delimiter) is only recognised OUTSIDE quotes, comments, here-strings
# and $(( )) arithmetic. An unterminated body runs to the end, as bash reads it. `EOF)` also ends a
# body, so a heredoc closed inside $( ) cannot swallow the commands after it.
strip_heredoc_bodies() {
  local line s cmp flag delim out=""
  local -a queue=()
  local re_sq="<<(-?)[[:space:]]*'([^']*)'"
  local re_dq='<<(-?)[[:space:]]*"([^"]*)"'
  local re_bs='<<(-?)[[:space:]]*[\]([A-Za-z0-9_.-]+)'
  local re_q1="'[^']*'"
  local re_q2='"[^"]*"'
  local re_ar='\$?\(\([^)]*\)\)'
  local re_cm='(^|[[:space:]])#.*$'
  local re_hd='<<(-?)[[:space:]]*([A-Za-z0-9_.-]+)'

  while IFS= read -r line || [ -n "$line" ]; do
    if [ "${#queue[@]}" -gt 0 ]; then                  # inside a body: drop the line
      flag=${queue[0]%%:*}
      delim=${queue[0]#*:}
      cmp=${line%$'\r'}
      [ "$flag" = "1" ] && cmp=${cmp#"${cmp%%[!$'\t']*}"}   # <<- strips leading tabs only
      if [ "$cmp" = "$delim" ] || [ "$cmp" = "$delim)" ]; then
        queue=("${queue[@]:1}")
      fi
      continue
    fi
    out+="$line"$'\n'

    s=${line//'<<<'/'   '}                             # here-strings are not heredocs
    while [[ $s =~ $re_sq ]]; do s=${s/"${BASH_REMATCH[0]}"/"<<${BASH_REMATCH[1]}${BASH_REMATCH[2]}"}; done
    while [[ $s =~ $re_dq ]]; do s=${s/"${BASH_REMATCH[0]}"/"<<${BASH_REMATCH[1]}${BASH_REMATCH[2]}"}; done
    while [[ $s =~ $re_bs ]]; do s=${s/"${BASH_REMATCH[0]}"/"<<${BASH_REMATCH[1]}${BASH_REMATCH[2]}"}; done
    while [[ $s =~ $re_q1 ]]; do s=${s/"${BASH_REMATCH[0]}"/__Q__}; done   # <<EOF inside quotes
    while [[ $s =~ $re_q2 ]]; do s=${s/"${BASH_REMATCH[0]}"/__Q__}; done
    while [[ $s =~ $re_ar ]]; do s=${s/"${BASH_REMATCH[0]}"/ }; done      # $((1<<X))
    if [[ $s =~ $re_cm ]]; then s=${s%"${BASH_REMATCH[0]}"}; fi          # # cat <<EOF
    while [[ $s =~ $re_hd ]]; do                        # queue every heredoc opened on this line
      if [ "${BASH_REMATCH[1]}" = "-" ]; then queue+=("1:${BASH_REMATCH[2]}"); else queue+=("0:${BASH_REMATCH[2]}"); fi
      s=${s#*"${BASH_REMATCH[0]}"}
    done
  done < <(printf '%s\n' "$1")                         # trailing \n, or the last line is never read
  printf '%s' "$out"
}

CMD=$(strip_heredoc_bodies "$CMD")
# ...then collapse quotes and match exactly as before. The heredoc's OWN command line is kept,
# so `cat <<'EOF' | wrangler deploy` is still blocked.
```

## NOTES
- Ship it with a matrix where **every allow case has a block twin**. Allows: `<<'EOF'`, `<<EOF`, `<<"PY"`, `<<\EOF`, `<<-EOF` with tab-indented body and delimiter, two heredocs on one line, a heredoc inside `$( )` closed on its own line, an unterminated body, CRLF line endings. Blocks: a deploy after the heredoc ends, after a `<<-` heredoc, after the second of two heredocs, `<<EOF` inside double or single quotes, `<<EOF` in a comment, a here-string `<<<`, a shift in `$(( ))`, a deploy on the heredoc's own command line, `EOF)` closing a body inside `$( )`, and a delimiter indented WITHOUT `<<-` (which does not close the body).
- Build the deploy words in the test from parts (`["dep","loy"].join("")`) so running the tests through the session's own Bash does not trip the live gate.
- Prefer the Write/Edit tools for file content anyway: they never pass through a Bash gate, and on Windows they avoid heredoc CRLF surprises.
- Related on this shelf: `hook-argv-walk-zero-iterations-printf-newline.md` (why the `printf '%s\n'` above matters), `hook-does-not-inherit-command-env.md` (collapsing quoted regions), `hook-git-commit-filter-needs-argv-walk.md`.
