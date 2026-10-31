---
tech: godot
tags: [export, pck, exclude_filter, json, gut]
severity: high
---
# Godot exports every .json file as a resource, so stray config JSON ships inside the PCK

## PROBLEM
Godot 4 treats `.json` as a resource type, so an `all_resources` export bundles every JSON file in the project, including tool config like `.gutconfig.json`, into the PCK.
Nothing warns: the export succeeds, and excluding `tests/*` and `addons/gut/*` does not catch a config file sitting at the project root.

## WRONG
```ini
[preset.0]
export_filter="all_resources"
exclude_filter="tests/*, tools/*, addons/gut/*"
; res://.gutconfig.json still ships in the PCK
```

## RIGHT
```ini
[preset.0]
export_filter="all_resources"
exclude_filter="tests/*, tools/*, addons/gut/*, .gutconfig.json"
```
```bash
# Text resources are stored readable in the PCK, so grep can verify exclusion in CI.
if grep -alE 'should_exit|tools/smoke|GutScene' build/*/*.pck; then exit 1; fi
```

## NOTES
Verified on Godot 4.7.2 (Windows and Linux presets). The PCK grew from 3,068 to 3,268 bytes with the config included. Content JSON under `data/` is meant to ship; only stray config needs excluding.
