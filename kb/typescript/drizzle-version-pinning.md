---
tech: typescript
tags: [drizzle, orm, version, beta, migrations, package-json]
severity: high
---
# Pin Drizzle to ^0.45.x -- v1 beta has breaking migration folder changes

## PROBLEM
Drizzle ORM v1.0.0-beta introduced breaking changes to the migration folder structure and RQBv2 (Relational Query Builder). Depending on your project, `^0.45.0` with semver caret could auto-resolve to `0.45.x` correctly, but if `v1` graduates from `beta` to `latest`, a fresh install would pull the breaking version.

## WRONG
```json
{
  "dependencies": {
    "drizzle-orm": "^1.0.0-beta"  // explicitly on beta with breaking changes
  }
}
```

```bash
# BAD -- if v1 becomes latest, this pulls breaking version
npm install drizzle-orm
```

## RIGHT
```json
{
  "dependencies": {
    "drizzle-orm": "^0.45.0"  // stays on 0.45.x series, won't jump to v1 beta
  }
}
```

## NOTES
- npm semver: `^0.45.0` resolves to `>=0.45.0 <0.46.0`. It will NOT auto-resolve to `1.0.0` even if released, because the major version differs.
- Beta/RC tags (`1.0.0-beta`) are not selected by default by npm even if you have `"drizzle-orm": "latest"`. They require explicit version or `@beta` tag to install.
- When intentionally upgrading to v1, plan a migration window: migration folder structure changes means existing migration files need to be reorganized.
- `drizzle-kit` (the CLI) must be upgraded in sync with `drizzle-orm` -- mismatched versions cause migration generation failures.
