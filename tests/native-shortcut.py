"""Send the screenshot accelerator to a unique test window on isolated Xvfb."""
import ctypes
import os
import sys
import time

if os.environ.get("SHORTCUTS_ISOLATED_DISPLAY") != "1":
    raise SystemExit("Native input requires an isolated test display")

x11 = ctypes.CDLL("libX11.so.6")
xtst = ctypes.CDLL("libXtst.so.6")
window_t = ctypes.c_ulong
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x11.XDefaultRootWindow.restype = window_t
x11.XQueryTree.argtypes = [ctypes.c_void_p, window_t, ctypes.POINTER(window_t), ctypes.POINTER(window_t), ctypes.POINTER(ctypes.POINTER(window_t)), ctypes.POINTER(ctypes.c_uint)]
x11.XFetchName.argtypes = [ctypes.c_void_p, window_t, ctypes.POINTER(ctypes.c_char_p)]
x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
x11.XInternAtom.restype = ctypes.c_ulong
x11.XGetWindowProperty.argtypes = [ctypes.c_void_p, window_t, ctypes.c_ulong, ctypes.c_long, ctypes.c_long, ctypes.c_int, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_void_p)]
x11.XFree.argtypes = [ctypes.c_void_p]
x11.XSetInputFocus.argtypes = [ctypes.c_void_p, window_t, ctypes.c_int, ctypes.c_ulong]
x11.XRaiseWindow.argtypes = [ctypes.c_void_p, window_t]
x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XKeysymToKeycode.restype = ctypes.c_uint
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]

display = x11.XOpenDisplay(None)
if not display:
    raise SystemExit("Could not open test display")
try:
    root = x11.XDefaultRootWindow(display)
    root_out, parent = window_t(), window_t()
    children = ctypes.POINTER(window_t)()
    count = ctypes.c_uint()
    x11.XQueryTree(display, root, ctypes.byref(root_out), ctypes.byref(parent), ctypes.byref(children), ctypes.byref(count))
    matches = []
    names = []
    name_atom = x11.XInternAtom(display, b"_NET_WM_NAME", 0)
    for index in range(count.value):
        name = ctypes.c_void_p()
        actual_type, items, remaining = ctypes.c_ulong(), ctypes.c_ulong(), ctypes.c_ulong()
        actual_format = ctypes.c_int()
        x11.XGetWindowProperty(display, children[index], name_atom, 0, 4096, 0, 0, ctypes.byref(actual_type), ctypes.byref(actual_format), ctypes.byref(items), ctypes.byref(remaining), ctypes.byref(name))
        if name.value:
            text = ctypes.string_at(name, items.value).decode(errors="replace")
            names.append(text)
            if sys.argv[1] in text:
                matches.append(children[index])
            x11.XFree(name)
    x11.XFree(children)
    if len(matches) != 1:
        raise SystemExit(f"Expected one fixture window, found {len(matches)}; test window names: {names}")
    x11.XRaiseWindow(display, matches[0])
    x11.XSetInputFocus(display, matches[0], 1, 0)
    x11.XSync(display, 0)
    time.sleep(0.1)
    keys = [x11.XKeysymToKeycode(display, x11.XStringToKeysym(key)) for key in [b"Alt_L", b"Shift_L", b"s"]]
    for key in keys:
        xtst.XTestFakeKeyEvent(display, key, 1, 0)
    for key in reversed(keys):
        xtst.XTestFakeKeyEvent(display, key, 0, 0)
    x11.XSync(display, 0)
finally:
    x11.XCloseDisplay(display)
