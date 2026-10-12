---
tech: openai-sites
tags: [sites, publishing, asset-packaging, image-delivery, size-limit]
severity: medium
---
# Sites deployments reject oversized archive inputs

## PROBLEM

An image-heavy Sites batch can appear ready locally yet fail before publication because Sites rejects an archive input over its 256 MiB limit. A source-only saved version does not bypass that limit: its remote build can fail on the same oversized input. In the confirmed frame-review batch, the required-only 20-family archive was 308 MiB with 340 MiB of static assets, and both native archive upload and the source-only remote-build path failed. A crown-only 15-family archive at 242,384,688 bytes (265,984,000 unpacked archive-storage bytes) succeeded.

## WRONG

```bash
# Retry an oversized source archive and assume remote build avoids upload limits.
sites publish --source-only review-catalog/

# Or silently replace the archival proof images with lower-quality originals.
```

## RIGHT

```bash
# Preflight both payload views before publication.
measure_compressed_archive review-catalog.zip
measure_expanded_static_assets review-catalog/

# Include only required review assets. Retain original proofs and their hashes,
# then create separately authorized compressed, full-resolution viewing copies.
sites publish --archive review-catalog-viewing-copies.zip
verify_mobile_review
verify_publish
```

## NOTES

This is a Sites publish-input limit, not a Cloudflare platform-wide limit. Treat archival originals and publishable viewing copies as distinct, traceable artifacts; do not downsample or discard originals silently.
