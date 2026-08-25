---
tech: linux
tags: [xwayland, wayland, x11, xlib, xgetimage, screen-capture, remote-desktop, portal, pipewire]
severity: high
---
# XWayland reports a viewable root window of the right size and still refuses XGetImage

## PROBLEM

On an XWayland session every check you would make before capturing the screen
passes. `XGetGeometry` on the root window returns the full multi-monitor size,
`XGetWindowAttributes` reports `map_state == IsViewable` and `depth == 24`,
XRandR enumerates every connected output with correct positions and modes --
and `XGetImage` then returns `BadMatch` for **any** region, including a 100x100
grab at the origin.

The reason is that XWayland does not composite native Wayland surfaces into the
X root window. The root exists as a drawable and has a size, because X clients
need one; it simply holds no pixels. There is nothing to read and no argument
you can pass that makes there be.

This is worth its own entry because every diagnostic points somewhere else:

- The geometry is right, so it does not look like a coordinate bug.
- The window is viewable, so it does not look like an unmapped-window problem.
- Clamping the request to the root's bounds -- the standard fix for a genuine
  `BadMatch` from a region extending past the drawable -- changes nothing,
  which sends you looking for a *second* bug.
- It reproduces on a machine where `DISPLAY` is set, `xdpyinfo` works, and
  other X clients run fine, because they draw rather than read.

The trap that puts you here is that an XWayland session sets **both**
`WAYLAND_DISPLAY` and `DISPLAY`. Code that tests `DISPLAY` first -- the
obvious order, and correct for a decade -- selects the X11 path on a Wayland
desktop, connects successfully, and then captures nothing. A capture backend
that "works" and returns black or errors per frame is a worse failure than one
that refuses at startup, because it looks like a driver or permissions problem
on the customer's machine.

## WRONG

```c
// Detection: DISPLAY is set, so this must be X11.
const char *display = getenv("DISPLAY");
if (display != NULL) {
    use_x11_capture();      // On XWayland this connects and captures nothing.
}

// Capture: everything below reports success right up to XGetImage.
Display *d = XOpenDisplay(NULL);
Window root = XRootWindow(d, XDefaultScreen(d));

Window child; int x, y; unsigned int w, h, border, depth;
XGetGeometry(d, root, &child, &x, &y, &w, &h, &border, &depth);
// w=9441 h=3840 depth=24 -- all correct

XWindowAttributes attrs;
XGetWindowAttributes(d, root, &attrs);
// attrs.map_state == IsViewable -- also correct

XImage *img = XGetImage(d, root, 0, 0, 100, 100, AllPlanes, ZPixmap);
// BadMatch. And with Xlib's default error handler installed, the process
// does not even get to see the NULL -- see the companion entry on exit().
```

## RIGHT

```c
// Detection: check WAYLAND_DISPLAY *before* DISPLAY, and prefer the session
// type logind reports when it is available.
//
// XDG_SESSION_TYPE is authoritative when set. WAYLAND_DISPLAY comes next and
// must be tested before DISPLAY, because an XWayland session sets both and
// answering "x11" there produces a backend that connects and captures nothing.
static const char *detect_session(void) {
    const char *type = getenv("XDG_SESSION_TYPE");
    if (type && strcmp(type, "wayland") == 0) return "wayland";
    if (type && strcmp(type, "x11") == 0)     return "x11";

    if (getenv("WAYLAND_DISPLAY")) return "wayland";   // before DISPLAY
    if (getenv("DISPLAY"))         return "x11";
    return "none";
}
```

```c
// Capture on Wayland: there is no XGetImage equivalent, by design. A client
// cannot read the screen; only the compositor can. The only sanctioned route
// is xdg-desktop-portal's ScreenCast interface over PipeWire:
//
//   CreateSession -> SelectSources -> Start -> OpenPipeWireRemote
//
// Start shows the user a dialog. There is no unattended path and no policy to
// pre-approve it -- plan for a human being present, or do not plan to capture
// a Wayland desktop at all.
```

```c
// And if something forces the X11 path onto a Wayland session anyway, say so
// rather than reporting a generic BadMatch. This is the error a technician
// will actually read.
if (session_is_wayland()) {
    return error("X11 capture of %s was refused (BadMatch); this is an "
                 "XWayland session, where the X root window holds no pixels "
                 "for native Wayland surfaces -- use the portal backend",
                 monitor_id);
}
```

## NOTES

- **Verified against a real compositor**, not inferred from documentation: root
  geometry `9441x3840`, `map_state=2 (IsViewable)`, `depth=24`, and
  `XGetImage(d, root, 0, 0, 100, 100, ...)` -> `BadMatch (invalid parameter
  attributes), Major opcode 73 (X_GetImage)`.
- Clamping the requested rectangle to the root window's true geometry is still
  worth doing -- XRandR's layout and the root drawable genuinely differ on some
  multi-head setups, and a region past the drawable is a real `BadMatch` cause.
  It is simply not *this* cause, and fixing it will not make XWayland capture.
- XWayland *windows* belonging to X clients can be captured individually. It is
  the composited root that is empty. If you only need one X application's
  window this is not a blocker; if you need "the screen", it is.
- The Wayland portal path may return a `restore_token` when `persist_mode` is
  requested. Backends that honour it re-approve silently on later runs, which
  is the difference between prompting once and prompting every session -- worth
  storing, but never rely on it, since honouring it is optional.
- See the companion entry on Xlib's default error handler: a `BadMatch` from
  this call will terminate your process outright unless you have installed your
  own handler first, so the two are usually met at the same time.
