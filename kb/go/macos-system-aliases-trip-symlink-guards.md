---
tech: go
tags: [macos, filesystem, symlink, path-safety, os-root, tests, file-transfer]
severity: high
---
# A strict symlink guard rejects macOS's own var, tmp and etc aliases

## PROBLEM
A file-transfer boundary correctly rejected every symbolic-link ancestor using
handle-relative Lstat/OpenRoot checks. Its Mac build compiled, but every native
transfer test failed at var: macOS exposes /var, /tmp and /etc as OS-defined
aliases into /private. t.TempDir commonly returns a /var/folders path, so even
safe temporary files were unreachable. Cross-compilation did not exercise any
of these filesystem operations.

## WRONG
Do not fix this with filepath.EvalSymlinks over the requested path: that also
accepts customer-controlled links that the original security boundary refuses.

## RIGHT
Translate ONLY the exact macOS root aliases lexically before opening directories:

```go
for _, alias := range []string{"/var", "/tmp", "/etc"} {
    if path == alias || strings.HasPrefix(path, alias+"/") {
        path = "/private" + path
        break
    }
}
```

Then run the original handle-relative checks on EVERY component of that canonical
path. Keep the requested path bound to approvals and audit; this translation is
a platform filesystem boundary detail.

## NOTES
Restrict the mapping to Darwin builds. A prefix such as /variable is not /var;
a user-created link under /var remains forbidden. Test standard aliases, boundary
prefixes, traversal, and a real customer-created symlink on a Mac. APFS clone and
exclusive-rename behavior also needs native tests, not only compilation.
