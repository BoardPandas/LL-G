---
tech: linux
tags: [x264, libx264, soname, dlopen, cgo, go, deb, packaging, ldd]
severity: high
---
# Linking libx264 pins a binary to one distro family because x264's soname is its build number

## PROBLEM
A binary linked against libx264 starts only on distros that ship the exact x264 build it was linked on, because libx264's soname is its X264_BUILD number (163 on Ubuntu 22.04 and EL9, 164 on Debian 12/13, Ubuntu 24.04 and Fedora 42, 165 on Ubuntu 26.04, Fedora 43, openSUSE and Arch).
It is silent. A deb with `Depends: libx264-164 | libx264-163` installs cleanly everywhere, but the binary's DT_NEEDED names one soname, so elsewhere it fails at load with `libx264.so.163: cannot open shared object file` while the package manager reports success. A glibc-floor check (`objdump -T | grep GLIBC_`) cannot see it. In Go, any import of a cgo package that links x264, even one made only for pure-Go helpers, carries the dependency into every binary that imports it.

## WRONG
```go
/*
#cgo pkg-config: x264
#include <x264.h>
*/
import "C"
// DT_NEEDED libx264.so.<build-machine's build>; nfpm Depends lists alternatives
// that apt happily satisfies with a different soname.
```

## RIGHT
```c
// dlopen whichever verified build is installed; refuse unknown ones.
static const int builds[] = {165, 164, 163};
void *lib = dlopen("libx264.so.165", RTLD_NOW | RTLD_LOCAL); /* ...try each, then "libx264.so" */
// x264_encoder_open is a macro for x264_encoder_open_<X264_BUILD>:
// dlsym that name per build; the one present identifies the ABI.
open = dlsym(lib, "x264_encoder_open_164");
// x264_param_t grew in builds 161, 162 and 163 (fps, timebase, annexb, repeat-headers move):
x264_param_t *p = calloc(1, 16384);          // default_preset memsets the LIBRARY's sizeof
default_preset(p, "veryfast", "zerolatency");
p->i_width = w; p->i_height = h; p->i_csp = X264_CSP_NV12;  // offsets stable 155..165
param_parse(p, "fps", "30/1");   // with force-cfr, x264 derives the timebase from fps
param_parse(p, "force-cfr", "1");
param_parse(p, "annexb", "1");
param_parse(p, "repeat-headers", "1");
param_parse(p, "keyint", "60");
param_parse(p, "crf", "23");     // whole numbers: parsed with locale-dependent atof
```
Detect it with `ldd -r` on every binary inside clean containers of each target distro, with only the package's Depends installed, and fail CI if any binary has `NEEDED libx264`.

## NOTES
- Pin the layout you rely on at compile time: x264_picture_t (240 bytes), x264_nal_t (40 bytes), the offsets of i_width, i_height and i_csp, and the NV12/IDR/AUTO constants. X264_CSP_NV12 changed from 3 to 4 at build 156.
- Builds 155 and 160 ship only on glibc 2.31 distros; if your glibc floor is 2.34 they are unreachable anyway.
- A machine with no x264 should still start every binary; only the encoder fails, with an error naming the package to install.
- Related: github-actions/a-ubuntu-latest-label-migration-silently-raises-the-glibc-floor-of-a-binary (glibc is not the only distro floor).
