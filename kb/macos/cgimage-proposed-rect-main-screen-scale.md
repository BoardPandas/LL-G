---
tech: macos
tags: [macos, appkit, nsimage, retina, cursor, backing-scale]
severity: medium
---
# CGImageForProposedRect with a nil context picks the main screen's scale

## PROBLEM
[image CGImageForProposedRect:&rect context:nil hints:nil] selects the best representation for the main screen. Reading a cursor (or any multi-rep image) for a pointer on a 1x external display next to a Retina panel yields the wrong resolution, and nothing reports it.

## WRONG
```objc
CGImageRef img = [cursor.image CGImageForProposedRect:&r context:nil hints:nil];
```

## RIGHT
```objc
// draw into a bitmap sized for the target display's backingScaleFactor
NSBitmapImageRep *rep = ...pixelsWide:w*scale pixelsHigh:h*scale...;
[NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:rep]];
[cursor.image drawInRect:NSMakeRect(0,0,w*scale,h*scale)];
```

## NOTES
Compute the scale from the display under the pointer, the same way the capturer sizes that display.
