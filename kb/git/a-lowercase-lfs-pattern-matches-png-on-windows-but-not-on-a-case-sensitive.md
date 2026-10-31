---
tech: git
tags: [git-lfs, gitattributes, case-sensitivity, core.ignorecase, windows, ci, assets]
severity: high
---
# A lowercase LFS pattern matches .PNG on Windows but not on a case-sensitive checkout, so Linux CI gets pointer files

## PROBLEM
A `.gitattributes` LFS pattern such as `*.png` (exactly what `git lfs track "*.png"` writes) matches `ROCK.PNG` on Windows and default macOS, where `core.ignorecase=true`, but not on a case-sensitive checkout such as a Linux CI runner.
It is not obvious because everything works where the files are added: on Windows the uppercase asset is cleaned into LFS, `git lfs ls-files` lists it, and the push succeeds. On a Linux checkout the same path has no `filter=lfs` attribute, so the smudge filter never runs and the working tree holds the small pointer text instead of the image. Nothing errors until an import or export step reads a "PNG" that is 130 bytes of text. A new uppercase file committed from Linux is also stored as an ordinary blob instead of in LFS. Asset packs routinely ship `.PNG`, `.FBX`, `.WAV`.

Verified with `git check-attr filter -- game/assets/pack/ROCK2.PNG`: with the pattern `game/**/*.png`, `-c core.ignorecase=true` gives `lfs` and `-c core.ignorecase=false` gives `unspecified`.

## WRONG
```gitattributes
# Written by `git lfs track "*.png"` -- lowercase only
*.png filter=lfs diff=lfs merge=lfs -text
*.fbx filter=lfs diff=lfs merge=lfs -text
```

## RIGHT
```gitattributes
# Character classes match every case on every platform
*.[pP][nN][gG] filter=lfs diff=lfs merge=lfs -text
*.[fF][bB][xX] filter=lfs diff=lfs merge=lfs -text
```

```bash
# Check both behaviours before trusting a pattern
git -c core.ignorecase=true  check-attr filter -- assets/ROCK.PNG   # expect: lfs
git -c core.ignorecase=false check-attr filter -- assets/ROCK.PNG   # expect: lfs
```

## NOTES
- Generate the classes with a small script rather than by hand; a typo in one class silently drops that extension.
- Scope the patterns to the asset folder (`game/**/*.[pP][nN][gG]`) so images elsewhere, such as docs, stay ordinary blobs.
- Renaming pack files to lowercase on import also helps and avoids `git/case-colliding-tracked-paths`. The classes still guard against a file that slips through.
- Separate trap: Git for Windows configures the LFS filters system-wide, so LFS appears to work in a clone that has no LFS `pre-push` hook. That clone pushes pointers without objects. Run `git lfs install` (or `git lfs update` for hooks only) in every clone.
