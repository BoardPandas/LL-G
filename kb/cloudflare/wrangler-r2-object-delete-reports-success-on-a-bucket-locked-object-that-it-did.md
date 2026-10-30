---
tech: cloudflare
tags: [r2, wrangler, bucket-lock, backups, retention]
severity: high
---
# wrangler r2 object delete reports success on a bucket-locked object that it did not delete

## PROBLEM
`wrangler r2 object delete` on an object covered by an R2 bucket lock rule prints "Delete complete" and exits 0, but the object is still there.
The S3 API refuses the same delete with `409 ObjectLockedByBucketPolicy`, so wrangler is swallowing the refusal. A script that trusts wrangler's output believes it pruned or cleaned up, and a test of the lock done through wrangler looks like the lock does not work.

## WRONG
```bash
wrangler r2 object delete my-bucket/backups/old.dump --remote
# "Delete complete." -> assume it is gone
```

## RIGHT
```bash
wrangler r2 object delete my-bucket/backups/old.dump --remote
# Re-read: the object is still returned while the lock holds
wrangler r2 object get my-bucket/backups/old.dump --remote --pipe >/dev/null && echo "still present"
# Test the lock over the S3 API, which reports the truth:
# DELETE -> HTTP 409 <Code>ObjectLockedByBucketPolicy</Code>
```

## NOTES
Seen with wrangler 4.152. A lock rule with an Age condition blocks deletes and overwrites for that age. That is what makes a bucket-scoped Object Read & Write token safe for backup uploads: a leaked token cannot delete history. Use unique, timestamped keys, because overwrites are blocked too.
