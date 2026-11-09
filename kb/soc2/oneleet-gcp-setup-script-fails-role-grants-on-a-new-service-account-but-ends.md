---
tech: soc2
tags: [oneleet, gcp, iam, service-account, eventual-consistency, cloud-shell]
severity: high
---
# Oneleet GCP setup script fails role grants on a new service account but ends looking successful

## PROBLEM
Oneleet's Google Cloud setup script grants project roles to its new service account immediately after creating it, so the grants fail with "Service account ... does not exist" while the final step succeeds and the output looks complete.
New service accounts take up to about 60 seconds to propagate in GCP IAM. The script's last step (Token Creator for Oneleet's identity on the account) runs later and prints an "Updated IAM policy" block, so the errors scroll past. Oneleet can impersonate the account, but the account has no project roles and Oneleet reads nothing.

## WRONG
```bash
gcloud iam service-accounts create "$sa_name" --project="$project"
for role in "${roles[@]}"; do
  gcloud projects add-iam-policy-binding "$project" \
    --member="serviceAccount:$sa_email" --role="$role"   # fails: account not propagated
done
```

## RIGHT
```bash
# Wait ~60s after creation, re-run only the roles loop, then verify:
gcloud projects get-iam-policy "$project" \
  --flatten="bindings[].members" \
  --filter="bindings.members:$sa_name@" \
  --format="value(bindings.role)"
# Must list every role in the script's roles=( ... ) array.
```

## NOTES
Scroll back through the whole output, not just the end. The same propagation delay affects any script that creates a GCP service account and binds it in the same run.
