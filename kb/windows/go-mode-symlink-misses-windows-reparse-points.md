---
tech: windows
tags: [go, filesystem, junctions, reparse-points, path-safety]
severity: high
---
# Go ModeSymlink does not identify every Windows reparse point

## PROBLEM
A Windows directory junction can pass a Go `FileInfo.Mode() & os.ModeSymlink` check. A file browser then treats the junction as an ordinary folder or permits mutations that were meant to reject all links. Root-relative opening may independently refuse an escaping junction, hiding the incomplete check until delete, move, or listing behavior is tested.

## WRONG
```go
if info.Mode() & os.ModeSymlink != 0 {
    return errors.New("links are refused")
}
```

## RIGHT
```go
func isLink(info os.FileInfo) bool {
    if info.Mode() & os.ModeSymlink != 0 { return true }
    attrs, ok := info.Sys().(*syscall.Win32FileAttributeData)
    return ok && attrs.FileAttributes & syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0
}
```

## NOTES
Keep this Windows-specific check in a build-tagged file; Unix implementations use ModeSymlink. Apply it to ancestor validation, final file opens, mutations, and directory-entry labels. It is not a substitute for pinned directory handles and race-safe filesystem operations.

Test actual junctions, not only os.Symlink. Symlink creation often needs a privilege unavailable to CI, so a skipped symlink test does not validate the Windows boundary. A temp-directory junction created with `mklink /J` exposed a real delete-path acceptance bug in SupportForge RMM-030. The regression now checks browse/read/delete/move refusal and the listing's blocked-link marker.
