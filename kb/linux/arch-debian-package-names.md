---
tech: linux
tags: [arch, pacman, makepkg, pkgbuild, packaging, debian, libclang, bindgen, pipewire, ci]
severity: medium
---
# Debian package names do not exist on Arch (libclang, libpipewire-0.3)

## PROBLEM
Package names get copied from a Debian/Ubuntu install line into an Arch `pacman` line or PKGBUILD. Arch splits packages differently and uses different names:

- There is **no `libclang` package** on Arch. `libclang.so`, which bindgen loads (via clang-sys, for crates such as pipewire-sys and libspa-sys), ships inside `clang`.
- `libpipewire-0.3` is a **soname, not a package**. The headers and `.pc` file come from `libpipewire`. Arch lists the soname as `libpipewire-0.3.so=0-64` in the package's provides, so the bare name matches nothing.
- `cargo` is a **virtual package** with two providers (`rust`, `rustup`). Naming it makes pacman show a provider prompt.

A single unknown target fails the whole `pacman -Syu` transaction with `error: target not found: libclang`. An unresolvable makedepends entry makes `makepkg` fail with missing dependencies. The Debian/Ubuntu jobs keep passing, so only the Arch release artifact goes missing. It shows up as a fast failure in a job nobody watches closely.

## WRONG
```bash
# Debian names carried over to Arch
pacman -Syu --noconfirm --needed rust cargo clang libclang pipewire
# PKGBUILD
makedepends=('rust' 'cargo' 'clang' 'libpipewire-0.3')
```

## RIGHT
```bash
pacman -Syu --noconfirm --needed rust clang pipewire libpipewire
# PKGBUILD (cargo is fine here: makepkg resolves provides without prompting)
makedepends=('rust' 'cargo' 'clang' 'libpipewire')

# Verify every name resolves before shipping:
podman run --rm docker.io/archlinux:base-devel bash -c \
  'pacman -Sy >/dev/null && pacman -Sp rust clang pipewire libpipewire >/dev/null && echo ok'
```

## NOTES
- To find the package that owns a file, look at the file list at `https://archlinux.org/packages/extra/x86_64/<pkg>/files/json/`, or run `pacman -F libclang.so`.
- A release that shipped with a broken PKGBUILD cannot be fixed by re-running its workflow, because the build checks out that tag's PKGBUILD. Cut a new version.
- Hit in Hark 0.60.4 (Arch release job) and fixed in 0.60.5 on 2026-09-30.
