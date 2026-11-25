---
tech: cloudflare
tags: [r2, s3, aws-sdk, versionid, object-storage]
severity: high
---
# R2 returns a VersionId on writes but rejects VersionId on every read

## PROBLEM
Cloudflare R2's S3 API returns a `VersionId` from CopyObject/PutObject, but any HeadObject or GetObject that carries `VersionId` (including a presigned GET URL with `versionId=`) fails with 501 NotImplemented ("versionId not implemented"). For HEAD there is no body, so the AWS SDK surfaces it as an error named `Unknown`/`UnknownError` with no message. Code that records the returned id and pins later reads to it fails every read: in our case every stored artifact failed verification and no job that depended on one ever ran, with nothing in the logs pointing at versioning.

## WRONG
```ts
const { VersionId: versionId } = await s3.send(new CopyObjectCommand({ Bucket, Key, CopySource }));
// later
await s3.send(new HeadObjectCommand({ Bucket, Key, ...(versionId && { VersionId: versionId }) }));
```

## RIGHT
```ts
const isR2 = /\.r2\.cloudflarestorage\.com$/i.test(new URL(endpoint).hostname);
const { VersionId } = await s3.send(new CopyObjectCommand({ Bucket, Key, CopySource }));
const versionId = isR2 ? undefined : VersionId; // never record or send it for R2
await s3.send(new HeadObjectCommand({ Bucket, Key, ...(versionId && { VersionId: versionId }) }));
// Pin content by size + sha256 recorded at upload and verified on download instead.
```

## NOTES
Logging only `err.name` hides this; log `err.$metadata.httpStatusCode` (501) too. Tests against AWS S3 or MinIO pass, because both honour VersionId.
