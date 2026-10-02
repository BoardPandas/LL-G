---
tech: claude-code
tags: [hooks, pretooluse, heredoc, command-text-gate, rm-rf, delete-gate, bash]
severity: high
---
# A delete gate cannot skip heredoc bodies the way a deploy gate can

## PROBLEM
`command-text-gates-must-skip-heredoc-bodies.md` says to drop heredoc bodies before matching,
because a body is input to a command, never a command. That holds for a deploy gate. For a
recursive-delete gate it is wrong: a body fed to an interpreter IS executed. Examples:
`bash <<EOF`, `ssh host <<EOF`, `cat <<EOF | sh`, `tee >(bash) <<EOF`, `python3 - <<PY`,
`source /dev/stdin <<EOF`. Stripping those bodies silently lets `rm -rf` through.

Walking every body instead is the safe direction, but it refuses harmless text:
`cat > notes.md <<'EOF'` or `git commit -F - <<'EOF'` whose content merely mentions `rm -rf`
or `Remove-Item -Recurse -Force`. On 2026-10-01 that blocked writing an LL-G entry whose
example code used Remove-Item. The refusal said "do not retry through another tool", which
read as forbidding the Write tool, the intended route.

A second trap is deciding per heredoc, by asking whether the heredoc's own line runs an
interpreter. That lets `cat > x.sh <<'EOF' ... EOF` followed by `bash x.sh` in the same
command through.

## WRONG
```bash
# Unconditional: a body fed to bash or ssh is dropped, and its rm -rf is never seen
CMD=$(strip_heredoc_bodies "$CMD")

# Per heredoc: keep a body only if its own line runs an interpreter.
# `cat > x.sh <<'EOF'` ... `EOF` ... `bash x.sh` passes: the bash is on a later line.
```

## RIGHT
```bash
# Strip, then look for an executor anywhere in the STRIPPED command. Keep every body if
# one is found; drop them only when none is. Never consult the bodies themselves: lesson
# text that names pwsh is still text.
may_run_a_body() {                 # $1 = command, quotes collapsed, split into tokens
  local tok t
  for tok in $1; do
    t=${tok##*/}; t=${t##*\\}; t=${t%.exe}          # basename, drop .exe (input lower-cased)
    case "$t" in
      bash|sh|zsh|dash|ksh|pwsh|powershell|cmd|eval|exec|xargs|ssh|wsl|sudo|su|doas|\
      iex|invoke-expression|start-process|source|.|python|python[0-9]*|py|node|deno|bun|\
      perl|ruby|php|lua|awk|gawk|sed|parallel|sftp|lftp|nc|plink) return 0 ;;
    esac
  done
  return 1
}

STRIPPED=$(strip_heredoc_bodies "$CMD")
if ! may_run_a_body "$(to_segments "$(collapse_quotes "$STRIPPED")")"; then
  CMD=$STRIPPED
fi
# then collapse quotes and match as before. The heredoc's own command line is always
# kept, so `cat <<EOF > f && rm -rf x` still blocks.
```

## NOTES
- Keep the executor set broad. Anything ambiguous keeps the bodies, which is the old,
  over-blocking behaviour and the safe one for a delete gate.
- Test matrix: every allow has a block twin. Allows: cat > file, git commit -F -, tee file,
  `<<-` bodies, two text heredocs, CRLF, and a body that names an interpreter. Blocks: each
  executor above, write-then-run in one command, and a delete before, after, or on the
  heredoc's line. Prove it by running the new allows against the OLD hook (they must fail),
  and every block case against both versions.
- Fix the refusal text too: say plainly that writing text is not a workaround, and name the
  Write tool.
- Reference: BoardPandas/tech-assistant `.claude/scripts/block-rm-rf.sh` and `_heredoc.sh`,
  commit 6c6daef (1.31.4).
- Related: `command-text-gates-must-skip-heredoc-bodies.md`, `hook-validates-text-not-state.md`,
  `hook-git-commit-filter-needs-argv-walk.md`.
