---
tech: nodejs
tags: [npm, npm-12, allow-remote, EALLOWREMOTE, tarball, install, cli, ci-smoke-test]
severity: high
---
# npm 12 refuses `npm install -g <tarball URL>` unless `--allow-remote=all`

## PROBLEM
npm 12 changed the default of `allow-remote` from `all` to `none`. Any install whose spec is a
remote tarball URL now fails with `EALLOWREMOTE` ("Fetching packages of type "remote" have been
disabled"), including a plain global install of a self-hosted CLI. Tarballs on the same host as the
configured registry are still allowed, so registry installs look unaffected.

It ships silently because the usual smoke test installs from a LOCAL FILE tarball, and `allow-file`
still defaults to `all`. Build, unit tests, a pack-and-install CI guard and a Windows CI job were
all green; the documented command failed for every user on npm 12 and was found only in
production verification.

## WRONG
```bash
# documented install command
npm install -g https://example.com/cli/tool.tgz        # npm 12: EALLOWREMOTE

# CI "smoke test" that cannot see it: installs a file, not a URL
pnpm pack --pack-destination "$tmp"
npm install -g --prefix "$tmp/p" "$tmp"/tool-*.tgz      # passes on npm 12
```

## RIGHT
```bash
# documented install command: works on npm 12, 11 (knows the setting), 10 (ignores it)
npm install -g --allow-remote=all https://example.com/cli/tool.tgz

# smoke test through the SAME transport users use: serve the tarball on 127.0.0.1
# and install from that URL with exactly the documented flags
npm install -g --allow-remote=all --prefix "$tmp/p" "http://127.0.0.1:$port/tool.tgz"
```

## NOTES
- Verified on npm 12.1.0 in `@npmcli/config/lib/definitions/definitions.js`: `allow-remote`
  default `none` (types `all|none|root`); `allow-git` also defaults to `none`; `allow-file` and
  `allow-directory` stay `all`. `root` only covers URLs in a project's package.json, not a CLI arg.
- Check the effective value with `npm config get allow-remote`.
- General lesson: an install smoke test must use the command people type, through the same
  transport, not an "equivalent" path.
- Source: BoardPandas/tcg 3.681.1.0 (`scripts/check-cli-pack.mjs` installs from both a file and a URL).
