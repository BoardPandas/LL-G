---
tech: linux
tags: [xlib, x11, error-handler, daemon, exit, cgo, crash, XSetErrorHandler]
severity: high
---
# Xlib's default X error handler calls exit(), so one protocol error kills your daemon

## PROBLEM

Xlib ships a default error handler that prints a message to stderr and calls
`exit(1)`. It does this from inside a library, on whichever thread made the
call, with no way for the caller to intervene. A single `BadMatch`,
`BadDrawable` or `BadWindow` -- the ordinary consequence of a monitor being
unplugged, a window closing between two calls, or a display server restart --
terminates the entire process.

For a short-lived X utility that is arguably reasonable. For a long-running
process it is catastrophic, and the failure is close to undiagnosable from the
outside:

- The process is simply **gone**. There is no panic, no Go stack trace, no
  crash dump, no non-zero exit path your own code ever ran.
- Your own logging never fires, because the handler exits before returning to
  your call site. The last thing in your log is whatever you wrote *before*
  the X call.
- The message goes to **stderr**, not to your logger. In a systemd unit with
  `StandardError=journal` it lands in the journal under the unit rather than in
  the application's own log file, so anyone reading the app log sees an abrupt
  silence with no error at all.
- Under `Restart=always` the daemon comes straight back, so the symptom is a
  service that "restarts occasionally" rather than one that crashes.

X protocol errors are also **asynchronous**. They are delivered when the client
next flushes or syncs, so an error caused by call A frequently surfaces during
call B -- which means even after you install a handler, you must `XSync` before
attributing an error to a specific call.

## WRONG

```c
// No handler installed. Xlib's default is in force.
Display *d = XOpenDisplay(NULL);
Window root = XRootWindow(d, XDefaultScreen(d));

// If this is an XWayland session, or the region is outside the drawable, or
// the monitor was unplugged a moment ago, this raises BadMatch --
// and the process EXITS here. `img` is never assigned, the NULL check below
// never runs, and the error never reaches the log.
XImage *img = XGetImage(d, root, x, y, w, h, AllPlanes, ZPixmap);
if (img == NULL) {
    log_error("capture failed");   // unreachable
    return -1;
}
```

```go
// The Go framing makes it worse, because it looks like it is handled.
img := C.XGetImage(c.display, C.Drawable(c.root), ...)
if img == nil {
    return fmt.Errorf("XGetImage failed")   // never reached; the process is gone
}
```

## RIGHT

```c
// Install a non-fatal handler before any other X call. The handler must
// return -- its return value is ignored by Xlib, and returning is what
// replaces the exit().
static int sf_x_error_seen = 0;
static int sf_x_error_code = 0;

static int sf_x_error(Display *d, XErrorEvent *e) {
    (void)d;
    sf_x_error_seen = 1;
    sf_x_error_code = e->error_code;
    return 0;                 // returning at all is the point
}

// Clears and returns the last code, 0 for none.
static int sf_take_error(void) {
    int code = sf_x_error_seen ? sf_x_error_code : 0;
    sf_x_error_seen = 0;
    sf_x_error_code = 0;
    return code;
}
```

```go
// XSetErrorHandler is process-global state, so gate it behind a sync.Once and
// install it before the first X call of the process -- not per connection.
var xErrorHandlerOnce sync.Once

func newCapturer() (*capturer, error) {
    display := C.XOpenDisplay(nil)
    if display == nil {
        return nil, errors.New("could not open the X display")
    }
    xErrorHandlerOnce.Do(func() { C.sf_install_error_handler() })
    return &capturer{display: display}, nil
}

func (c *capturer) capture() (*image.RGBA, error) {
    C.sf_take_error()          // clear anything left by an earlier call

    img := C.XGetImage(c.display, C.Drawable(c.root), ...)

    // MANDATORY: X errors are asynchronous. Without this sync the BadMatch
    // caused here is read on some later call and blamed on the wrong one.
    C.XSync(c.display, C.False)

    if code := C.sf_take_error(); code != 0 {
        if img != nil {
            C.sf_destroy_image(img)
        }
        return nil, fmt.Errorf("X server refused the capture (%s)", xErrorName(int(code)))
    }
    if img == nil {
        return nil, errors.New("XGetImage returned nothing")
    }
    defer C.sf_destroy_image(img)
    return convert(img)
}
```

## NOTES

- `XSetErrorHandler` returns the previous handler and is **process-global**, not
  per-`Display`. Install it once, before the first X call, and never per
  connection.
- The handler's return value is ignored. What matters is that it returns rather
  than exiting; anything you do inside it must not itself make X calls, or you
  risk recursing.
- There is a **second** fatal handler: `XSetIOErrorHandler`, for I/O errors --
  the display connection dropping, which is what a display server restart or a
  user logout looks like. Its handler is not permitted to return; the process
  must exit or `longjmp` out. Installing one at least lets you log the reason
  and shut down cleanly instead of dying inside Xlib.
- `XDestroyImage` is a **macro** dispatching through the image's own function
  table, so cgo cannot reference it -- wrap it in a real C function. Same for
  several other Xlib "functions" that are macros.
- The same trap exists in any language binding over Xlib, not just cgo: the
  handler is Xlib's, so Python/Rust/Zig bindings inherit it unless they install
  their own.
- Frequently met alongside the XWayland entry in this slice: on an XWayland
  session `XGetImage` raises `BadMatch` for every region, so the first thing
  the default handler does is take the process down.
