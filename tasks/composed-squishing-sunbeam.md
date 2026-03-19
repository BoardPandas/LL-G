# Plan: Merge Existing Repo Lessons Learned into LL-G

## Context

The LL-G KB was just built as a clean structure with seed entries. Several other repos under `C:\Github\` already have pattern files and agent-memory with field-tested gotchas. This plan merges all of that content into LL-G, creating new tech folders and augmenting existing ones.

Source repos: `tech-assistant`, `Shadow-Arena`, `60k-mono`

---

## Source Files to Read During Execution

Read these in full at the start of execution -- they contain the raw content to convert:

| Source File | Destination Tech |
|---|---|
| `C:\Github\tech-assistant\deploy\POWERSHELL-GOTCHAS.md` | `kb/powershell/` (new entries + update existing) |
| `C:\Github\tech-assistant\deploy\GRAPH-API-PATTERNS.md` | `kb/graph-api/` (new folder) |
| `C:\Github\tech-assistant\deploy\TEAMS-SHAREPOINT-PATTERNS.md` | `kb/graph-api/` (additional entries) |
| `C:\Github\Shadow-Arena\GODOT-GOTCHAS.md` | `kb/godot/` (new folder) |
| `C:\Github\Shadow-Arena\GDSCRIPT-PATTERNS.md` | `kb/godot/` (additional entries) |
| `C:\Github\Shadow-Arena\.claude\TROUBLESHOOTING-PATTERNS.md` | `kb/bash/` (jq gotcha) |
| `C:\Github\60k-mono\.claude\patterns\TYPESCRIPT-GOTCHAS.md` | `kb/better-auth/` + `kb/typescript/` |
| `C:\Github\60k-mono\.claude\patterns\AUTH-PATTERNS.md` | `kb/better-auth/` |
| `C:\Github\60k-mono\.claude\agent-memory\decisions.md` | `kb/typescript/` (Drizzle version entry) |

Do NOT include project-specific architectural decisions (which DB, which engine, etc.) -- only patterns that apply beyond that one project.

---

## New Tech Folders to Create

### `kb/powershell/` -- AUGMENT existing (4 new entries)

New entries (read source file for full content):

| File | Title | Severity | Source |
|---|---|---|---|
| `utc-dates.md` | Always use UTC for Graph API and date comparisons | HIGH | POWERSHELL-GOTCHAS |
| `strict-mode-variables.md` | Initialize variables before conditional branches under StrictMode | HIGH | POWERSHELL-GOTCHAS |
| `special-chars-in-strings.md` | > is redirection and parens with spaces misparse in strings | HIGH | POWERSHELL-GOTCHAS |
| `bash-to-powershell.md` | Never pass complex scripts inline via -Command from bash | HIGH | POWERSHELL-GOTCHAS |

Also update existing entries:
- `array-safety.md` -- add StrictMode null-check note from POWERSHELL-GOTCHAS
- `error-handling.md` -- add nested try/catch pattern for cleanup operations

### `kb/graph-api/` -- NEW (11 entries)

Read GRAPH-API-PATTERNS.md and TEAMS-SHAREPOINT-PATTERNS.md for content.

| File | Title | Severity |
|---|---|---|
| `cert-auth.md` | Certificate must be in CurrentUser\\My not LocalMachine | HIGH |
| `disconnect-finally.md` | Always Disconnect-MgGraph in finally block | HIGH |
| `403-admin-consent.md` | 403 = missing admin consent, not missing permission | MEDIUM |
| `permission-propagation.md` | New permissions take 1-15 min to propagate -- disconnect/reconnect | HIGH |
| `key-credentials.md` | KeyCredentials: use RawData, cert dates, PascalCase params | HIGH |
| `pagination.md` | Always use -All or follow @odata.nextLink (999 item limit) | HIGH |
| `exchange-online.md` | Exchange Online needs Exchange.ManageAsApp + Exchange Admin role + domain not GUID | HIGH |
| `filter-encoding.md` | URL-encode single quotes as %27 in filter queries | MEDIUM |
| `ca-policy-patch.md` | PATCH conditions.users must include full object, not just excluded users | HIGH |
| `throttling.md` | 429/503: SDK auto-retries but Invoke-MgGraphRequest does not | MEDIUM |
| `channel-provisioning.md` | Channel creation is async -- poll for provisioning before accessing file folder | MEDIUM |

### `kb/godot/` -- NEW (9 entries)

Read GODOT-GOTCHAS.md and GDSCRIPT-PATTERNS.md for content.

| File | Title | Severity |
|---|---|---|
| `projectile-parent.md` | Projectiles must be children of a container node, not the player | HIGH |
| `sub-resource-ids.md` | Sub-resource IDs in .tscn must be unique strings | HIGH |
| `preload-paths.md` | @preload paths must match exact file locations or crash at parse | HIGH |
| `collision-layers.md` | collision_layer = what I am; collision_mask = what I detect | HIGH |
| `canvasmodulate.md` | CanvasModulate must be near-black (0.02, 0.02, 0.04), NOT (0,0,0) or lights vanish | HIGH |
| `type-inference.md` | := type inference fails when accessing script properties through base-class-typed vars | MEDIUM |
| `timer-callbacks.md` | Timer callbacks can outlive source node -- check is_instance_valid(self) | HIGH |
| `onready-paths.md` | @onready var paths must match .tscn node names exactly | HIGH |
| `no-class-name-autoload.md` | Do not use class_name on autoload scripts (naming conflicts) | MEDIUM |

### `kb/better-auth/` -- NEW (5 entries)

Read TYPESCRIPT-GOTCHAS.md and AUTH-PATTERNS.md for content.

| File | Title | Severity |
|---|---|---|
| `client-import.md` | Use better-auth/react for React hooks, NOT better-auth/client | HIGH |
| `method-names.md` | Method names are camelCase from URL paths -- check types before calling | MEDIUM |
| `verify-email-token.md` | verifyEmail token goes in query param, not top-level body | HIGH |
| `cross-subdomain-cookies.md` | Cross-subdomain cookies require crossSubDomainCookies config with leading dot | HIGH |
| `browser-env-vars.md` | Browser auth client uses import.meta.env not process.env | HIGH |

### `kb/typescript/` -- AUGMENT existing (1 new entry)

| File | Title | Severity |
|---|---|---|
| `drizzle-version-pinning.md` | Pin Drizzle to ^0.45.x -- v1 beta has breaking migration folder changes | HIGH |

---

## master `llms.txt` Updates

Add entries for all new tech folders:

```
### Graph API (Microsoft)
- [Graph API index](kb/graph-api/llms.txt): All Microsoft Graph API gotchas (11 entries)

### Godot / GDScript
- [Godot index](kb/godot/llms.txt): All Godot and GDScript gotchas (9 entries)

### Better Auth
- [Better Auth index](kb/better-auth/llms.txt): All Better Auth framework gotchas (5 entries)
```

Update PowerShell entry count: 4 → 8
Update TypeScript entry count: 2 → 3

---

## What NOT to Include

Skip these -- they are project-specific decisions, not reusable gotchas:
- Which engine/language was chosen for Shadow-Arena (architectural decision)
- Which DB/ORM was chosen for 60k-mono
- Redis caching strategy for 60k-mono (implementation choice)
- Single-stage Docker pattern for 60k-mono (stack-specific)

---

## Execution Order

1. Read all 9 source files in parallel
2. Create `kb/graph-api/` (11 files: llms.txt + 10 entries)
3. Create `kb/godot/` (10 files: llms.txt + 9 entries)
4. Create `kb/better-auth/` (6 files: llms.txt + 5 entries)
5. Create new PowerShell entries (4 files)
6. Update existing PowerShell entries (2 edits)
7. Create new TypeScript entry (1 file)
8. Update `llms.txt` master index (add 3 techs, update 2 counts)

---

## Verification

- Check `llms.txt` entry counts match actual file counts in each folder
- Spot-check 2-3 entries for correct frontmatter format (tech, tags, severity)
- Confirm each tech folder has a `llms.txt` with all entries listed
