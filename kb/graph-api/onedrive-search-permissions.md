---
tech: graph-api
tags: [onedrive, search, permissions, sharepoint]
severity: medium
---
# OneDrive search requires Sites.ReadWrite.All, not just Files.ReadWrite.All

## PROBLEM
The OneDrive search endpoint is SharePoint-backed. `Files.ReadWrite.All` handles CRUD operations but search requires `Sites.ReadWrite.All`. Without it, search returns 403 even though other file operations work fine.

## WRONG
```powershell
# 403 on search even with Files.ReadWrite.All
Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$upn/drive/root/search(q='quarterly report')"
# accessDenied because search is SharePoint-backed
```

## RIGHT
```powershell
# Ensure Sites.ReadWrite.All is granted for search operations
# Files.ReadWrite.All handles CRUD; Sites.ReadWrite.All handles search
Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$upn/drive/root/search(q='quarterly report')"
```

## NOTES
- This applies to both `/drive/root/search` and `/drives/{id}/search` endpoints
- If you only need to list/read/write specific files by path, `Files.ReadWrite.All` is sufficient
- The 403 error message does not mention Sites.ReadWrite.All -- it just says "access denied"
