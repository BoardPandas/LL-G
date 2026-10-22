---
tech: redis
tags: [auth, acl, nopass, noauth, verification, hardening]
severity: high
---
# A passwordless ACL-era Redis accepts AUTH with any password, so clients with a password URL look healthy against an open server

## PROBLEM
On Redis 6+ with no password set (the `default` user is `nopass`), `AUTH default <anything>` succeeds, so an app connecting with a password in its URL works fine even when the server enforces nothing.
After "adding a password" you might change the client URLs first, see every app connect, and conclude auth is on. A healthy app proves nothing about enforcement.

## WRONG
```bash
# App connects with redis://default:<password>@host:6379 and works -> "auth enabled"
redis-cli -u "redis://default:anything@host:6379" PING   # PONG even with no password configured
```

## RIGHT
```bash
# Prove enforcement with an UNauthenticated command
redis-cli -h host -p 6379 PING
# expect: (error) NOAUTH Authentication required.
# PONG here means the server is still open.
```

## NOTES
- Run the check over every network path a client can use (private network and any public proxy).
- The masking is specific to the ACL `nopass` default user; it is why client-side health checks are not proof of server-side auth.
