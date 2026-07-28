---
name: pnpm v11 ignores package.json pnpm.overrides, and range overrides DO re-resolve
description: On pnpm v11 overrides live in pnpm-workspace.yaml. A pnpm.overrides block in package.json is silently ignored -- no warning, no error, the vulnerable version just stays. Range overrides DO force re-resolution on v11 (unlike v10), so pin exact only when a parent's declared major constrains you.
type: gotcha
tech: pnpm
tags: [pnpm, overrides, dependencies, security, audit, lockfile, pnpm-workspace]
severity: high
---
# pnpm v11 ignores package.json `pnpm.overrides`, and range overrides DO re-resolve

## PROBLEM

Two things changed at pnpm v11. The existing entry [pnpm overrides need an exact version to force re-resolution](../typescript/pnpm-overrides-exact-version.md) describes v10 behaviour and is actively misleading if you apply it to v11.

**1. The location moved, and the old location fails silently.** pnpm v11 reads overrides from a top-level `overrides:` key in `pnpm-workspace.yaml`. It NO LONGER reads package.json's `pnpm.overrides` field. Put them in package.json on v11 and there is no warning, no error, and no deprecation notice: `pnpm install` reports success, the lockfile is unchanged, and the vulnerable transitive stays exactly where it was. The symptom is indistinguishable from "the override didn't force re-resolution", which sends you hunting for a resolver bug that isn't there -- and straight toward the v10 entry's exact-pin advice, which also won't help, because the whole block is being ignored.

**2. Range overrides work on v11.** The v10 claim -- that ranges act as a peer-dep-style constraint and never force re-resolution -- does not hold. On pnpm 11.5.0 a range override re-resolved a transitive across a MAJOR boundary away from its parent's declared range: `brace-expansion: ">=5.0.8"` installed 5.0.8 underneath `minimatch@3.1.5`, which itself declares `brace-expansion: ^1.1.7`.

There is still a reason to pin exact on v11, but it is a different reason than the v10 entry gives: a `>=` range resolves to the newest matching version *including new majors*, which can drag the PARENT outside its own declared range. `ajv` declares `fast-uri: ^3.0.1`, so `fast-uri: ">=3.1.4"` resolves to 4.1.1 and leaves ajv running against a major it never declared support for.

## WRONG

```jsonc
// package.json on pnpm v11 -- SILENTLY IGNORED.
// pnpm install succeeds, lockfile unchanged, pnpm audit still fails.
{
  "pnpm": {
    "overrides": {
      "fast-uri": "3.1.4"
    }
  }
}
```

```yaml
# pnpm-workspace.yaml -- right file, wrong version choice.
# ajv declares `fast-uri: ^3.0.1`, so this resolves to 4.1.1 and takes
# ajv outside its own declared range.
overrides:
  fast-uri: ">=3.1.4"
```

## RIGHT

```yaml
# pnpm-workspace.yaml -- pnpm v11 reads overrides HERE
overrides:
  # Range: correct when any newer version is acceptable. Lets a security
  # floor keep drifting upward without manual bumps.
  brace-expansion: ">=5.0.8"
  postcss: ">=8.5.18"
  sharp: ">=0.35.0"

  # Exact: required when the patched version must stay inside a parent's
  # declared major. ajv wants `fast-uri: ^3.0.1`; 3.1.4 is the patched
  # head of the 3.x line.
  fast-uri: 3.1.4
```

Then verify -- never assume an override took effect:

```bash
pnpm install
pnpm why fast-uri --prod                 # confirm the RESOLVED version
pnpm audit --prod --audit-level high     # must exit 0
```

## NOTES

Verified on pnpm 11.5.0 (2026-07-28) while clearing 11 high-severity advisories across six packages. Range overrides confirmed re-resolving by `pnpm why <pkg> --prod`: `js-yaml >=5.2.2` -> 5.2.2, `postcss >=8.5.18` -> 8.5.23, `sharp >=0.35.0` -> 0.35.3, `brace-expansion >=5.0.8` -> 5.0.8.

Scopes [../typescript/pnpm-overrides-exact-version.md](../typescript/pnpm-overrides-exact-version.md), which is correct for pnpm v10 (verified 10.33.2) but not v11. Check `pnpm --version` before applying either.

`pnpm-workspace.yaml` also carries `allowBuilds:` on v11, since `strictDepBuilds` now defaults to true -- a dependency with a postinstall script fails the install with `ERR_PNPM_IGNORED_BUILDS` until it is listed there (`true` allows, `false` denies).

**Second-order gotcha: security override floors go stale.** Three pins in the same repo (`js-yaml >=4.1.2`, `postcss >=8.5.10`, `brace-expansion >=5.0.6`) had been overtaken by NEWER advisories against the same packages. The file looked protective -- each pin carried a comment citing its GHSA -- while `pnpm audit` was failing on those exact three. A pin with a GHSA comment is evidence that a package was patched once, not that it is patched now. Re-run the audit rather than reading the override list.
