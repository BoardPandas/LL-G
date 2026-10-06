---
tech: claude-code
tags: [hooks, pretooluse, release-gate, heredoc]
severity: medium
---
# A release-authorisation hook blocks commands that merely mention a deploy command

## PROBLEM
Writing a changelog entry or script via `python3 - <<EOF` whose body mentioned 'wrangler deploy' or 'every deploy' was blocked as an unauthorised production deploy, three times in one session. The hook reads the whole command string, not just the program being run.

## WRONG
```bash
python3 - <<'EOF'
entry = '... declared so every deploy keeps it ...'
EOF
```

## RIGHT
```bash
# Write tool -> .claude/kb-scratch/edit.py, then:
python3 .claude/kb-scratch/edit.py
```

## NOTES
If a gate fires on non-deploy text, fix its match list rather than disabling it.
