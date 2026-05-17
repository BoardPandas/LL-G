---
tech: architecture
tags: [microservices, monorepo, data-ownership, duplication, source-of-truth, migration]
severity: high
---
# Check sibling services for an existing store before building a parallel one

## PROBLEM

In a multi-service codebase (a shared monorepo, or several services against one database), it is easy to add a new local datastore for data that a sibling service already owns and maintains. The new store becomes a second, redundant copy with its own redundant ingestion/sync path. The two copies drift; consumers disagree about the source of truth; and if the redundant copy lives somewhere non-durable (an ephemeral container file, a dev-only SQLite file), it is silently destroyed and rebuilt on deploy -- taking any locally-written user data with it.

The trap is that each service in isolation looks correct. The redundancy is only visible when you look across service boundaries -- exactly the step that gets skipped when you start from "this service needs data X, so add a table for X here."

## WRONG

```text
service-A/  owns rules_* in Postgres `public`, syncs from upstream daily
service-B/  needs rules data, so it:
              - adds its own rules.sqlite
              - adds its own daily sync job from the SAME upstream
              - stores rules.sqlite in a non-mounted container dir
=> a 3rd redundant copy + redundant sync; user data lost on every deploy
```

## RIGHT

```text
Before adding a store for data X, grep the whole repo / all services for
X's domain nouns. If a sibling already maintains X:
  - READ X from the owning service's store (schema-qualify if shared DB)
  - do NOT re-sync X -- the owner already does
  - put only genuinely-new, service-B-owned data in service-B's schema

service-B/  reads `public.rules_*`         (owned by service-A)
            writes only `dashboard.rules_user_notes`, etc. (its own data)
```

## NOTES

- Symptoms you already have this problem: two sync jobs hitting the same upstream, or two tables with the same domain name in different schemas/services.
- User-generated data must live in a durable, backed-up store -- never an ephemeral or unmounted container path.
- Discovering the sibling store usually makes the task *smaller*: you delete a sync path instead of writing one.
- Discovered during the TCG dashboard rules migration: the dashboard kept a redundant `rules.sqlite` plus its own CR sync, while the API service already maintained the full ruleset in Postgres `public.rules_*`.
