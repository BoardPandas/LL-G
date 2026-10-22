---
tech: bash
tags: [curl, pipefail, installer, self-update, codex, openai]
severity: high
---
# curl | sh turns a failed installer download into a successful no-op, so self-updaters report success without updating

## PROBLEM
`curl -fsSL <url> | sh` exits 0 when the download fails, because sh receives empty input and runs nothing successfully.
`-f` makes curl exit 22 on an HTTP error, but without `pipefail` the pipeline's status is sh's, not curl's. Any tool that self-updates this way then prints its success message. Observed with OpenAI Codex CLI's `codex update`: its installer URL (`https://chatgpt.com/codex/install.sh`) returned 404, curl printed `(22) The requested URL returned error: 404`, and Codex still printed "Update ran successfully! Please restart Codex." The binary stayed on the old version. The only visible sign is one curl line buried above the success banner.

## WRONG
```bash
codex update                       # trusts the banner
curl -fsSL https://example.com/install.sh | sh   # 404 -> exit 0
```

## RIGHT
```bash
before=$(codex --version)
codex update
[ "$(codex --version)" != "$before" ] || echo "update did not apply"

# Fetch to a file, check it, read it, then run it
curl -fsSL -o install.sh https://github.com/openai/codex/releases/latest/download/install.sh \
  && sh install.sh
# or, in your own scripts:
set -o pipefail
```

## NOTES
- Verify any self-update by comparing the version before and after. Never trust its exit code or banner.
- Codex's installer is also attached to each GitHub release (`releases/download/rust-v<ver>/install.sh`). It honours `CODEX_NON_INTERACTIVE=1`.
- Downloading to a file first also lets you read the script before running it.
