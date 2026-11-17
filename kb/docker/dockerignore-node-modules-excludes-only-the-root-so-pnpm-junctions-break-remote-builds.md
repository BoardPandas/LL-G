---
tech: docker
tags: [dockerignore, pnpm, windows, remote-builder, fly-io, node-modules, junctions]
severity: medium
---
# `.dockerignore`'s `node_modules` excludes only the root, so a Windows pnpm checkout breaks remote builds

## PROBLEM
In `.dockerignore`, a bare `node_modules` matches only `./node_modules` at the root of the build context. It does not match at any depth the way it does in `.gitignore`.

In a pnpm workspace every package has its own `node_modules`, and on Windows pnpm builds those out of junctions. The build context therefore picks up `packages/*/node_modules`. A remote builder (`fly deploy --remote-only`, or any remote BuildKit) then fails while it is still receiving the context:

```text
archive/tar: unknown file mode ?rwxr-xr-x
```

The error names neither the file nor `node_modules`, and it never reproduces on a clean Linux clone or in CI. There, nothing has been installed before the build, so the same Dockerfile and `.dockerignore` build fine.

## WRONG
```text
# .dockerignore
node_modules
.next
```

## RIGHT
```text
# .dockerignore
node_modules
**/node_modules
.next
**/.next
```

## NOTES
- The image installs its own dependencies anyway. The host's `node_modules` are never wanted in the context, and excluding them also shrinks the upload.
- Docker's `**` matches zero or more directories, so `**/node_modules` covers the root as well. Keeping the bare line is harmless.
- Apply the same `**/` form to any other per-package build output a workspace produces.
