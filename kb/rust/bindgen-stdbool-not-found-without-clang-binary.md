---
tech: rust
tags: [bindgen, libclang, clang, fedora, linux, pipewire, libspa-sys, build-script, stdbool]
severity: medium
---
# bindgen cannot find stdbool.h when libclang is installed but the clang binary is not

## PROBLEM
`bindgen` loads `libclang.so` but finds clang's own builtin headers (`stdbool.h`, `stddef.h`, `stdarg.h`) by asking the `clang` executable for its resource directory. On a machine with `clang-libs` but no `clang` package, for example Fedora, the lookup comes back empty. Any `-sys` build script that runs bindgen over system headers then fails with an error that looks like a broken dev package:

```
/usr/include/pipewire-0.3/pipewire/version.h:14:10: fatal error: 'stdbool.h' file not found
Unable to generate bindings: ClangDiagnostic(...)
```

`pkg-config` reports the library fine and the header exists under GCC's include directory, which sends you down the wrong path (reinstalling `pipewire-devel`). It shows up for `libspa-sys`/`pipewire` and any other crate that uses bindgen at build time.

## WRONG
```bash
sudo dnf reinstall pipewire-devel   # the PipeWire headers were never the problem
cargo build                          # same 'stdbool.h' file not found
```

## RIGHT
```bash
# Point bindgen at libclang's resource headers directly
find /usr/lib/clang /usr/lib64/clang -name stdbool.h 2>/dev/null   # e.g. /usr/lib/clang/23/include/stdbool.h
export BINDGEN_EXTRA_CLANG_ARGS="-I/usr/lib/clang/23/include"
cargo build
# or install the driver so bindgen can ask it: sudo dnf install clang
```

## NOTES
- The version directory (`23`) follows the installed LLVM, so a hard-coded path goes stale on the next LLVM upgrade. Installing `clang` is the durable fix, and the env var is the no-sudo one.
- CI images that `apt-get install clang` never see this, so it shows up only on developer machines.
