---
tech: powershell
tags: [powershell, json, openapi, case-sensitivity]
severity: high
---
# Windows PowerShell 5.1 ConvertFrom-Json rejects JSON whose keys differ only by case

## PROBLEM
ConvertFrom-Json in Windows PowerShell 5.1 builds case-insensitive objects, so a document with keys like `rating` and `Rating` in the same object fails with `Cannot convert the JSON string because a dictionary that was converted from the string contains the duplicated keys`. Plex's official OpenAPI spec hits this. In a script that continues past the error, every later property access returns empty and the run looks like the file is empty.

## WRONG
```powershell
$j = Get-Content spec.json -Raw | ConvertFrom-Json   # throws on rating/Rating
"paths: $($j.paths.PSObject.Properties.Count)"        # prints a wrong count if execution continues
```

## RIGHT
```powershell
# PowerShell 7: case-sensitive hashtable
$j = Get-Content spec.json -Raw | ConvertFrom-Json -AsHashtable
# Windows PowerShell 5.1: hand the parsing to Python (or System.Text.Json)
python -c "import json; j=json.load(open('spec.json','rb')); print(len(j['paths']))"
```

## NOTES
Use $ErrorActionPreference = 'Stop' so the failure cannot fall through to empty results.
