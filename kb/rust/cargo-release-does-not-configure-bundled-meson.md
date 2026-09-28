---
tech: rust
tags: [cargo, build-script, meson, native-dependencies, benchmarking, optimization, webrtc]
severity: high
---
# Cargo release does not configure a bundled Meson library

## PROBLEM

`cargo run --release` does not prove that a bundled C/C++ dependency uses its
intended native release configuration. A Rust build script can invoke Meson
without translating Cargo's profile into Meson options. Compilation succeeds,
the Rust executable reports release mode, and benchmarks silently compare
libraries built with different optimization or assertion policies.

In `webrtc-audio-processing-sys 2.1.0`, the bundled build script runs `meson setup`
with a prefix, reconfiguration, and static-library option, but no buildtype.
The bundled project's `meson.build` sets `buildtype=debugoptimized`. Meson maps
that to optimization level 2 with debug information, independently of Cargo's
`--release`.

## WRONG

```sh
cargo run --release --features bundled -- bench
# Record only "release" from the Rust executable and assume the native
# library also uses the intended release optimization/assertion settings.
```

## RIGHT

Inspect the dependency's native build command. Explicitly choose the desired
Meson options in that invocation, preserving its source, output, prefix, and
other required arguments. For a comparison that deliberately selects Meson's
release policy and disables C/C++ assertions:

```sh
meson setup --reconfigure --buildtype=release -Db_ndebug=true \
  native-build-dir native-source-dir
meson introspect --buildoptions native-build-dir
```

Verify and record `buildtype`, `optimization`, and `b_ndebug` from the generated
build configuration, alongside Rust/native compiler versions. Merely relabeling
the executable's profile or setting a variable the build script never reads
does not change the dependency. Use a fresh native output directory or explicitly
reconfigure the existing one, then rebuild before timing.

## NOTES

- The reviewed [v2.1.0 build script](https://github.com/tonarino/webrtc-audio-processing/blob/c14d7af1760baff83e8210fee336a0cae0faaa7d/webrtc-audio-processing-sys/build.rs)
  invokes Meson directly. Its [pinned bundled source](https://gitlab.freedesktop.org/pulseaudio/webrtc-audio-processing/-/blob/d0569cfa50c1858ee279d77b3fc8870be6902441/meson.build)
  supplies the `debugoptimized` default. This is a specific dependency finding,
  not a claim that every native Cargo dependency ignores the selected profile.
- [Meson's buildtype mapping](https://mesonbuild.com/Builtin-options.html#details-for-buildtype)
  distinguishes `debugoptimized` from `release`. Disabling debug information
  does not itself define `NDEBUG`; `b_ndebug` controls assertions separately.
  The appropriate assertion policy is an explicit build decision.
- Hark's 2026-09-28 isolated AEC comparison used Cargo release and explicitly
  configured Meson 1.12.1 with `buildtype=release`, `optimization=3`, and
  `b_ndebug=true`; the generated `intro-buildoptions.json` confirmed all three.
  The record is `tools/meeting-aec-bakeoff/RESULTS.md`. Its completed WSL run used
  GCC 14.2.0 and Rust 1.98.1 and contains 63 measurements: seven fixtures, three
  backends including bypass, and three repetitions.
- Those results were collected after choosing the native flags. They do not
  measure an O2-to-O3 speedup, prove native Windows C++ support, establish
  real-speaker AEC quality, or select a production engine.
