---
title: NinjaOne OAuth Authorization Code flow requires specific endpoint paths, client type, scopes, and query params
severity: HIGH
tags: [ninjaone, oauth, authorization-code, refresh-token, api, rmm]
---

## Problem

Setting up OAuth Authorization Code flow for NinjaOne script execution (`POST /device/{id}/script/run`) involves multiple non-obvious requirements that each cause different failures (404, "Invalid grant type", missing refresh token).

## Root Causes

Multiple gotchas compound:

1. **OAuth endpoints use `/ws/oauth/`, not `/oauth/`** -- The authorize and token endpoints are at `/ws/oauth/authorize` and `/ws/oauth/token`. Using `/oauth/authorize` (which looks correct and is what the MCP server uses for client_credentials token URL) returns HTTP 404.

2. **Instance URL is tenant-specific** -- NinjaOne instances can be at custom domains like `{tenant}.rmmservice.com`, not just `app.ninjarmm.com`. The OAuth endpoints must use the tenant's actual domain.

3. **"API Services" clients cannot do Authorization Code** -- NinjaOne API clients created with the "API Services (machine-to-machine)" platform type only support client_credentials. You must create a separate client with the "Web (PHP, Java, .Net Core, etc.)" platform type to get Authorization Code support. One client cannot support both grant types.

4. **`client_secret` must be in the authorize URL query string** -- Unlike standard OAuth2 (where client_secret is only sent during token exchange), NinjaOne requires it in the browser redirect URL. Without it, the authorize endpoint returns an error.

5. **`offline_access` scope required for refresh tokens** -- The default scopes `monitoring management control` are not enough. Without `offline_access`, no refresh token is returned in the token response.

## BAD

```powershell
# Wrong endpoint path (404)
$AuthorizeUrl = "https://app.ninjarmm.com/oauth/authorize"

# Wrong instance domain (404)
$AuthorizeUrl = "https://app.ninjarmm.com/ws/oauth/authorize"
# (when your instance is actually at {tenant}.rmmservice.com)

# Missing client_secret in authorize URL (error)
$authUrl = "$AuthorizeUrl?response_type=code&client_id=$id&redirect_uri=$redirect&scope=$scopes"

# Missing offline_access scope (no refresh token returned)
$Scopes = "monitoring management control"

# Trying to add auth code grant to existing API Services client ("Invalid grant type")
# The NinjaOne UI won't even show the option
```

## GOOD

```powershell
# Correct: tenant-specific domain + /ws/oauth/ path
$NinjaOneHost = "https://{tenant}.rmmservice.com"  # or app.ninjarmm.com, eu.ninjarmm.com, etc.
$AuthorizeUrl = "$NinjaOneHost/ws/oauth/authorize"
$TokenUrl = "$NinjaOneHost/ws/oauth/token"

# Correct: include client_secret in authorize URL
$authUrl = "$AuthorizeUrl?response_type=code&client_id=$id&client_secret=$secret&redirect_uri=$redirect&scope=$scopes&state=$state"

# Correct: include offline_access for refresh tokens
$Scopes = "monitoring management control offline_access"

# Correct: create a "Web" platform client, separate from the "API Services" client
# API Services client -> client_credentials (MCP server, read/write operations)
# Web client -> authorization_code + refresh_token (script execution)
```

## Notes

- The homotechsual/NinjaOne PowerShell module (authoritative open-source reference) confirms all of the above patterns in its `Connect-NinjaOne.ps1` source.
- Valid NinjaOne instance domains: `app.ninjarmm.com` (US), `eu.ninjarmm.com` (EU), `oc.ninjarmm.com` (OC), `ca.ninjarmm.com` (CA), `us2.ninjarmm.com` (US2), `{tenant}.rmmservice.com` (custom).
- The MCP server's client_credentials token URL (`/oauth/token` without `/ws/`) works for that grant type but is NOT the correct path for authorization code flow.
