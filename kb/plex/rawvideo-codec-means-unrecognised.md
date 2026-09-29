---
tech: plex
tags: [plex, pms, media, codec, rawvideo, analysis, avi]
severity: medium
---
# Plex's "rawvideo" codec means a file it could not identify, not uncompressed video

## PROBLEM
A Media element's `videoCodec="rawvideo"` reads like uncompressed video, and a report that trusts it will count those files as a codec of their own, or as huge and heavy. On a real library all 115 such files were old SD video at about 1.5 Mbps with MP3 or AC3 audio, which uncompressed video could never be: Plex's analysis did not recognise the codec (typically an old AVI-era DivX or Xvid encode). Plex also gave all of them `container="avi"`, although 30 were `.mkv` or `.mp4` files. Plex plays them as best it can, usually by transcoding, so nothing looks broken until someone reads the numbers.

## WRONG
```python
codec = media.attrib["videoCodec"]
counts[codec] += 1  # "rawvideo: 115" reads as a real format
heavy = int(media.attrib["bitrate"]) > 40000 or codec == "rawvideo"  # treats them as huge
```

## RIGHT
```python
codec = media.attrib.get("videoCodec", "")
if not codec:
    problem = "Plex has not analysed it"
elif codec == "rawvideo":  # uncompressed at an ordinary bitrate is impossible: Plex did not recognise the codec
    problem = f"Plex did not recognise the video (it says raw video at {int(media.attrib.get('bitrate') or 0) / 1000:.1f} Mbps)"
    ext = os.path.splitext(part.attrib.get("file", ""))[1].lstrip(".").lower()
    if ext and ext != media.attrib.get("container"):
        problem += f", and read the .{ext} file as {media.attrib['container'].upper()}"
```

## NOTES
- Seen on Plex 1.43.4 (Linux, Docker), 2026-09-28: 39 of 2,034 movies and 76 of 19,361 episodes.
- Re-analysing the item in Plex, or replacing the file, is the fix; list them as misread rather than as a codec share.
