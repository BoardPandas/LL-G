---
tech: cloudflare
tags: [r2, s3, presigned-url, content-disposition, cdn, redirect, express]
severity: high
---
# A redirect to a CDN URL drops the download filename your API chose

## PROBLEM
The browser saves a download under the final URL's name (or the final response's Content-Disposition). Redirecting to a public CDN/R2 URL therefore saves the file under the object key's name, discarding any filename the API computed. When the filename carries data -- e.g. a per-customer enrollment code in an installer name that the installer later reads -- the data silently vanishes and the download still "works".

## WRONG
```ts
res.redirect(302, spaces.getCdnUrl(build.file_path)) // saved as agent.msi; code lost
```

## RIGHT
```ts
const cmd = new GetObjectCommand({
  Bucket, Key: build.file_path,
  ResponseContentDisposition: `attachment; filename="${filename}"`,
})
res.redirect(302, await getSignedUrl(client, cmd, { expiresIn: 900 }))
// or stream the object with res.setHeader('Content-Disposition', ...)
```

## NOTES
The `download` attribute on an <a> is ignored cross-origin, so it cannot fix this. Keep the filename in the API URL path too, so `wget`/"copy link" name the file sensibly.
