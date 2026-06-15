---
tech: railway
tags: [railway, ssh, cli, host-key, non-tty, batchmode, one-off-script]
severity: medium
---
# `railway ssh` Hangs on Host-Key Verification in Non-TTY Shells

## PROBLEM
`railway ssh --service X -- <cmd>` fails with "Host key verification failed" and then hangs in any non-interactive (non-TTY) shell. The CLI tries to prompt you to accept the host key, but there is nowhere to answer the prompt, so the command blocks forever instead of erroring out. This blocks automated or agent-driven runs of one-off in-container scripts, which is exactly what you need when a data store (Redis, Postgres) has no public proxy and the only way to touch it is from inside a Railway service.

## WRONG
```bash
# Hangs forever in a non-TTY (CI, agent, piped shell): the host-key prompt
# has nowhere to be answered.
railway ssh --service Worker -- "cd /app && npx tsx src/scripts/recover.ts"
```

## RIGHT
```bash
# 1. Get the connection block (HostName ssh.railway.com, User = an env-scoped UUID).
railway ssh config --service Worker --alias flux -i ~/.ssh/railway_key --dry-run

# 2. Register your public key once with Railway.
railway ssh keys add --key "$(cat ~/.ssh/railway_key.pub)"

# 3. Use the SYSTEM ssh client instead of `railway ssh`, with non-interactive flags.
#    StrictHostKeyChecking=accept-new auto-accepts the key; BatchMode=yes makes it
#    fail fast instead of prompting.
ssh -i ~/.ssh/railway_key \
    -o StrictHostKeyChecking=accept-new \
    -o BatchMode=yes \
    <USER-UUID>@ssh.railway.com \
    "cd /app && npx tsx src/scripts/recover.ts"

# 4. Clean up the temp key afterward.
railway ssh keys remove <fingerprint>
```

## NOTES
- The `User` field is an environment-scoped UUID from the `config --dry-run` output, not your account name.
- A service started with `tsx` already has the source tree and `npx tsx` available in the container, so you can run a one-off `.ts` script directly; pino/logger stdout comes back over the ssh channel.
- This is the reliable path for in-container recovery work (e.g. re-enqueuing lost BullMQ jobs) on a service whose Redis/Postgres has only an internal `.railway.internal` host and no public proxy.
