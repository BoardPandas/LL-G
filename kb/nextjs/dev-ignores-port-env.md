---
tech: nextjs
tags: [port, env, dev, configuration, cli]
severity: medium
---
# Next.js dev mode ignores PORT env var

## PROBLEM
`next dev` does not read the `PORT` environment variable from `.env` files. Setting `PORT=4888` in `.env` has no effect -- the dev server always starts on port 3000. The `next start` command also ignores it. Only the `-p` CLI flag works. This is confusing because many Node.js frameworks (Express, Fastify) respect `PORT` automatically.

## WRONG
```bash
# .env
PORT=4888
HOSTNAME=0.0.0.0
```
```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "start": "next start"
  }
}
```
```
$ pnpm dev
▲ Next.js 15.x
- Local: http://localhost:3000   ← ignores PORT=4888
```

## RIGHT
```json
{
  "scripts": {
    "dev": "next dev --turbopack -p 4888 -H 0.0.0.0",
    "start": "next start -p 4888 -H 0.0.0.0"
  }
}
```

## NOTES
- The `-H` flag sets the hostname (needed for LAN access with `0.0.0.0`). Same issue -- `HOSTNAME` env var is also ignored.
- `next start` has the same behavior. Both require explicit `-p` and `-H` flags.
- NSSM service scripts or systemd units should also pass these via CLI args or `AppEnvironmentExtra`, not rely on `.env`.