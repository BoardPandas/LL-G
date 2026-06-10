---
tech: northflank
tags: [doppler, secrets, env-vars, deployment, outage]
severity: high
---
# Doppler configs do not auto-sync to Northflank, and the runtime env update is a full replace

## PROBLEM
Two compounding traps when Doppler is the secrets source of truth and Northflank is the runtime. (1) Adding a secret to a Doppler config does NOT make it appear in the Northflank service unless an explicit Doppler->Northflank integration sync is configured for that config; with no sync, the new env var silently never reaches the container and the dependent feature fails only at runtime (this caused a production inbound-webhook outage). (2) Updating a Northflank runtime environment via the API/MCP (`update_service_runtime_env`) REPLACES the entire env set with the payload you send, it does not merge. Sending just the one new variable wipes every other env var from the service on the next deploy.

## WRONG
```text
1. Add INBOUND_WEBHOOK_SECRET to the Doppler "nf" config.
2. Deploy the code that reads process.env.INBOUND_WEBHOOK_SECRET.
   -> Variable never arrives in the container; webhooks 401 in production.

# or, trying to fix it via API with a single-var payload:
northflank_update_service_runtime_env(serviceId, { INBOUND_WEBHOOK_SECRET: "..." })
   -> every OTHER env var on the service is now gone
```

## RIGHT
```text
1. Add the secret in Doppler (keeps it as source of truth for humans).
2. ALSO add it by hand to the Northflank secret group the service inherits
   (e.g. the doppler-env group), or configure a real Doppler->Northflank
   sync integration for that config.
3. If updating runtime env via API: GET the current env first, merge the new
   key into the full map, then PUT the complete set back.
4. Verify inside the container after deploy (print the key name, not the value).
```

## NOTES
Symptom signature of trap 1: the feature works locally (Doppler CLI injects the var) but fails deployed, with auth/4xx errors from whatever the missing secret guards. Treat any "add an env var" step in a deploy plan as TWO actions: source-of-truth update plus runtime delivery, and verify delivery explicitly.
