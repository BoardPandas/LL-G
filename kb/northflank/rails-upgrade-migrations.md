---
tech: northflank
tags: [northflank, postgresql, rails, hudu, migrations, db-privileges, addon, deployment, sidekiq]
severity: high
---
# Northflank Rails app upgrades: no auto-migrate, and the addon app role can't run DDL

## PROBLEM
Two gotchas stack up when upgrading a self-hosted Rails app (e.g. Hudu, `hududocker/hudu`) deployed on Northflank from an external Docker image, with the database on a Northflank PostgreSQL addon.

1. **Bumping the image tag does NOT run database migrations.** The container entrypoint does not run `rake db:migrate` on boot. After the tag bump the service deploys "COMPLETED" and the **login page still loads** (it touches minimal schema), so it looks healthy, but any authenticated/dashboard page 500s with `ActiveRecord::StatementInvalid: PG::UndefinedColumn` (e.g. `column companies.encrypted_radar_identifier does not exist`). The login-works-but-everything-else-500s pattern is the tell-tale sign of pending migrations.

2. **The addon's app role is not the table owner, so it can't run the migration.** A Northflank PostgreSQL addon issues two roles: a regular app user (`USERNAME`, the one the app connects as via `DB_USERNAME`) that has CRUD grants but owns nothing, and a separate `ADMIN_USERNAME` that owns every table. Running `rake db:migrate` as the app user fails with `PG::InsufficientPrivilege: ERROR: must be owner of table accounts`. Normal reads work (it has SELECT/INSERT/UPDATE), which is why the running app and `\dt` look fine, masking the ownership split.

Always back up the addon (`northflank_create_addon_backup`) before migrating, and after migrating restart BOTH the web and the worker (Sidekiq) services so Rails drops its stale in-memory schema cache, otherwise processes that booted before the columns existed keep 500ing.

## WRONG
```bash
# Bump the tag and assume the app migrates itself on boot, then run migrate as the app user.
# -> login page loads, dashboard 500s with PG::UndefinedColumn (migrations never ran)
# -> manual migrate as the app user dies with:
#    PG::InsufficientPrivilege: ERROR: must be owner of table accounts
northflank exec service --project hudu --service hudu-app \
  --shell-cmd 'bash -c' --cmd 'bundle exec rake db:migrate'
```

## RIGHT
```bash
# 1. Back up the addon first (rollback point).
#    -> northflank_create_addon_backup (project hudu, addon hudu-pg)

# 2. Run migrations as the ADMIN role that owns the tables, by overriding the
#    DB creds inline for just this command. Get ADMIN_USERNAME / ADMIN_PASSWORD
#    from northflank_get_addon_credentials on the Postgres addon.
northflank exec service --project hudu --service hudu-app \
  --shell-cmd 'bash -c' \
  --cmd 'DB_USERNAME=<ADMIN_USERNAME> DB_PASSWORD=<ADMIN_PASSWORD> bundle exec rake db:migrate'

# 3. Restart BOTH services so Rails reloads the schema cache.
#    -> northflank_restart_service hudu-app  AND  hudu-worker

# 4. Verify as the APP user (default env, no override): a query on a newly added
#    column should succeed, and db:migrate should report nothing pending.
northflank exec service --project hudu --service hudu-app \
  --shell-cmd 'bash -c' --cmd 'bundle exec rake db:migrate'   # clean no-op = done
```

## NOTES
- Migrations that only ADD columns/indexes to existing tables need no extra GRANTs afterward: PostgreSQL table-level privileges already held by the app user automatically cover new columns. But if a future migration CREATES a new table (owned by admin), the app user will lack privileges on it -- then also run, as admin, `GRANT ALL ON ALL TABLES/SEQUENCES IN SCHEMA public TO <app_user>` and `ALTER DEFAULT PRIVILEGES FOR ROLE <admin> IN SCHEMA public GRANT ALL ON TABLES TO <app_user>`.
- Northflank CLI exec quoting: use `--shell-cmd 'bash -c' --cmd '<command>'`. Do NOT wrap `<command>` in literal inner double quotes (the documented `--cmd '"..."'` form) -- bash then treats the whole quoted string as a single command name and exits 127 "command not found".
- `psql` is available inside the Hudu app container (`/usr/bin/psql`); to check ownership: `psql "$POSTGRES_URI_ADMIN" -c "SELECT tableowner, count(*) FROM pg_tables WHERE schemaname='public' GROUP BY tableowner;"`.
- Changing the deployment image on a Northflank deployment-type service is a POST to `/v1/projects/{p}/services/{s}/deployment` (not PATCH; the older MCP wrapper used PATCH and 405s). Prefer pinning an explicit version tag over `:latest`, which silently drifts.
- Related: [[postgres]] (boot-applied schema not retrofitting onto existing tables) and [[architecture]] (data ownership / source-of-truth) indexes.
