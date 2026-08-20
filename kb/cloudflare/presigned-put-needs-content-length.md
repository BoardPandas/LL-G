---
tech: cloudflare
tags: [r2, s3, presigned-url, upload, go, http, signature]
severity: high
---
# A presigned R2/S3 PUT needs an explicit Content-Length, or Go sends it chunked and the bucket refuses it

## PROBLEM

Uploading a file to a presigned PUT URL with Go's `http.Client` fails with an
opaque 4xx from the bucket, and the response body is usually an S3 XML error
that says nothing about the real cause.

Two independent reasons, both easy to hit at once:

1. **Chunked transfer encoding.** `http.NewRequest` only infers
   `ContentLength` for a body it recognises (`*bytes.Buffer`, `*bytes.Reader`,
   `*strings.Reader`). An `*os.File` -- which is what you want, because a
   recording or a build artifact should not be read into memory -- is an
   opaque `io.Reader`, so `ContentLength` stays 0, Go sends
   `Transfer-Encoding: chunked`, and S3-compatible storage rejects a chunked
   presigned PUT.
2. **Content-Type must match what was signed.** If the presigner included
   `ContentType` in the `PutObjectCommand`, that header is part of the signed
   canonical request. Omitting it, or sending a different one, produces
   `SignatureDoesNotMatch` -- which reads like a credential problem and sends
   you to check keys that are fine.

Neither is visible from the signing side. The URL looks correct, works from
`curl -T` (which sets Content-Length from the file), and fails only from the
program.

## WRONG

```go
file, _ := os.Open(path)
defer file.Close()

req, _ := http.NewRequest(http.MethodPut, uploadURL, file)
// ContentLength is 0 -> Transfer-Encoding: chunked
// no Content-Type -> signature was computed over one that is not being sent

resp, err := http.DefaultClient.Do(req)
// 400 / 403 with an S3 XML body, and nothing naming either cause
```

## RIGHT

```go
// Stat the file: the size is the Content-Length, and taking it from the file
// rather than from whatever reported it upstream means the header describes
// the bytes actually being sent.
info, err := os.Stat(path)
if err != nil {
    return err
}
file, err := os.Open(path)
if err != nil {
    return err
}
defer file.Close()

req, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, file)
if err != nil {
    return err
}
req.ContentLength = info.Size()          // stops chunked encoding
if contentType != "" {
    req.Header.Set("Content-Type", contentType)   // must match what was signed
}

resp, err := http.DefaultClient.Do(req)
if err != nil {
    return fmt.Errorf("upload: %w", err)
}
defer resp.Body.Close()
if resp.StatusCode < 200 || resp.StatusCode >= 300 {
    detail, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
    return fmt.Errorf("upload: %s: %s", resp.Status, bytes.TrimSpace(detail))
}
```

And on the signing side, return the content type alongside the URL so the
uploader cannot guess wrong:

```ts
const uploadUrl = await getSignedUrl(
  client,
  new PutObjectCommand({ Bucket, Key, ContentType: 'video/mp4' }),
  { expiresIn: 30 * 60 },
);
return { uploadUrl, contentType: 'video/mp4', expiresIn: 30 * 60 };
```

## NOTES

- Use a **plain** `http.Client` for the PUT, not the mTLS client used for the
  platform's own API. The signed URL is the authorization; the bucket is not
  your API, and presenting a device certificate to it sends a credential
  somewhere it does not belong.
- Read the error body. S3-compatible storage puts the real reason in XML
  (`SignatureDoesNotMatch`, `XAmzContentSHA256Mismatch`,
  `NotImplemented` for chunked) and returns a generic status. A handler that
  logs only `resp.Status` throws away the only useful signal.
- Size the URL's TTL against the *worst* uplink that will use it, not the
  best. A 30-minute window for a large object on a customer's connection is
  not generous; a 5-minute one turns a slow-but-working upload into a retry
  loop that never converges.
- Signed URLs are write handles on one object for their whole lifetime. Never
  log them, and mint a fresh one per attempt rather than storing one.
