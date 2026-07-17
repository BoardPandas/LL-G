---
tech: github-actions
tags: [azure-trusted-signing, artifact-signing, code-signing, service-principal, defaultazurecredential, signtool, secrets]
severity: high
---
# Azure Trusted Signing action: credentials go in `with:`, not `env:`

## PROBLEM
The Azure Trusted Signing GitHub Action authenticates via `DefaultAzureCredential` and reads the service-principal credentials from its OWN action inputs (`azure-client-id` / `azure-tenant-id` / `azure-client-secret`), which it promotes to action-scoped environment variables for the credential. If you instead set `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_CLIENT_SECRET` as the step's `env:`, the action rebuilds that environment from its own (empty) inputs and clobbers yours, so the credential sees nothing and auth fails with `EnvironmentCredential authentication unavailable. Environment variables are not fully configured.` Worse, an empty/missing signing secret never fails cleanly: signtool dies deep inside with an opaque `SignerSign() failed` (0x80004005), giving no hint that a secret was blank.

## WRONG
```yaml
- name: Sign
  uses: Azure/artifact-signing-action@v2
  env:                                   # clobbered by the action's own inputs
    AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
    AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
    AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
  with:
    endpoint: ${{ secrets.SIGN_ENDPOINT }}
    signing-account-name: ${{ secrets.SIGN_ACCOUNT }}
    certificate-profile-name: ${{ secrets.SIGN_PROFILE }}
    files-folder: target/release
    files-folder-filter: exe
```

## RIGHT
```yaml
# Preflight so an empty secret fails clearly, not as SignerSign() 0x80004005.
- name: Preflight signing secrets
  shell: pwsh
  env:
    AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
    AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
    AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
  run: |
    foreach ($n in 'AZURE_CLIENT_ID','AZURE_TENANT_ID','AZURE_CLIENT_SECRET') {
      if (-not (Get-Item "env:$n" -EA SilentlyContinue).Value) { throw "Empty secret: $n" }
    }

- name: Sign
  uses: Azure/artifact-signing-action@v2
  with:
    azure-client-id: ${{ secrets.AZURE_CLIENT_ID }}        # creds as INPUTS
    azure-tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    azure-client-secret: ${{ secrets.AZURE_CLIENT_SECRET }}
    endpoint: ${{ secrets.SIGN_ENDPOINT }}
    signing-account-name: ${{ secrets.SIGN_ACCOUNT }}
    certificate-profile-name: ${{ secrets.SIGN_PROFILE }}
    files-folder: target/release
    files-folder-filter: exe
    timestamp-rfc3161: http://timestamp.acs.microsoft.com   # not automatic
    timestamp-digest: SHA256

- name: Verify                                              # fail on silent no-op
  shell: pwsh
  run: |
    $s = Get-AuthenticodeSignature target/release/app.exe
    if ($s.Status -ne 'Valid') { throw "unsigned: $($s.Status)" }
    if (-not $s.TimeStamperCertificate) { throw "no timestamp" }
```

## NOTES
- **Rebrand/redirect (2026):** "Azure Trusted Signing" is now "Artifact Signing"; `Azure/trusted-signing-action` redirects to `Azure/artifact-signing-action@v2`. Current input names are `signing-account-name` and `certificate-profile-name` (older docs/versions used `trusted-signing-account-name`).
- **Timestamping is NOT automatic:** set `timestamp-rfc3161: http://timestamp.acs.microsoft.com` explicitly or the signature carries no trusted timestamp and expires with the cert.
- **`endpoint` region must match the account's region** (e.g. `https://eus.codesigning.azure.net/`) or you get a 403. The SP needs the **Trusted Signing Certificate Profile Signer** role on the cert profile, and account identity validation (1-20 business days) must be complete before signing works at all.
- **Secret-name discipline:** if secrets are synced from a manager (Doppler, etc.), the workflow's `secrets.*` names must exactly match the synced keys; a mismatch resolves to empty and triggers the same opaque `SignerSign() failed`, not a "missing secret" error. Related: `kb/azure` (service-principal RBAC vs Graph scopes).
