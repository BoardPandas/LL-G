---
tech: typescript
tags: [s3, r2, storage, buckets, default-parameters, email, attachments, silent-failure, best-effort]
severity: high
---
# Storage helper default-bucket divergence silently drops email attachments

## PROBLEM
A storage helper with an optional bucket parameter (`getFileStream(key, bucket?)` defaulting to one bucket) lets the write path and the read path silently diverge. The upload route wrote composer attachments to the media bucket explicitly, while the outbound-email sender called `getFileStream(key)` with no bucket and read from the default (builds) bucket — a deterministic NoSuchKey on every send. Compounded by a best-effort catch-and-skip around the fetch, the customer email went out with zero attachments while the ticket timeline showed the file attached and `delivery_status` said delivered. Silent, customer-facing wrong output, invisible in the sender's own UI, discovered only when a customer complained.

## WRONG
```typescript
// upload route
const MEDIA_BUCKET = process.env.SPACES_MEDIA_BUCKET || 'supportforge-media';
await uploadToSpaces(file.buffer, r2Key, mime, MEDIA_BUCKET); // writer: media bucket

// email sender (different file)
try {
  const stream = await getFileStream(ref.r2_key); // reader: default = builds bucket -> NoSuchKey
  // ...
} catch (err) {
  console.error(`fetch failed (skipping):`, err); // best-effort skip: email sends without the file
}
```

## RIGHT
```typescript
// one shared constant, exported next to the domain logic, used by writer AND reader
export const AGENT_ATTACHMENT_BUCKET = process.env.SPACES_MEDIA_BUCKET || 'supportforge-media';

// upload route
await uploadToSpaces(file.buffer, r2Key, mime, AGENT_ATTACHMENT_BUCKET);

// email sender: read the same bucket, and fail LOUD — an email that says
// "(attached)" must never send without its files
try {
  const stream = await getFileStream(ref.r2_key, AGENT_ATTACHMENT_BUCKET);
  // ...
} catch (err) {
  throw new AttachmentLoadError(ref.filename, (err as Error)?.message || 'fetch failed');
}
// caller maps AttachmentLoadError to an ok:false result so the agent sees which file failed
```

## NOTES
Two independent lessons compounded here: (1) an optional bucket/location parameter with a default invites writer/reader drift — share one exported constant (or make the parameter required) so the paths cannot disagree; (2) never best-effort-skip a side effect the user explicitly requested — a skipped attachment, webhook, or notification that the surrounding record still claims happened is worse than a failed request, because nothing surfaces the failure. A regression test pinning the reader to the shared constant (`expect(getFileStream).toHaveBeenCalledWith(key, AGENT_ATTACHMENT_BUCKET)`) locks both in.
