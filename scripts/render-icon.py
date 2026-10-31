"""Rasterize the original icon.svg using system librsvg/Cairo, without network assets."""
from pathlib import Path
import argparse
import ctypes as c
from ctypes.util import find_library


class Rectangle(c.Structure):
    _fields_ = [(name, c.c_double) for name in ("x", "y", "width", "height")]


def bind(library, name, result, *arguments):
    function = getattr(library, name)
    function.restype = result
    function.argtypes = arguments
    return function


def render(output, size):
    libraries = {name: find_library(name) for name in ("rsvg-2", "cairo", "gobject-2.0")}
    if not all(libraries.values()):
        raise SystemExit("Icon export requires system librsvg, Cairo and GObject libraries.")
    rsvg, cairo, gobject = (c.CDLL(libraries[name]) for name in libraries)
    load = bind(rsvg, "rsvg_handle_new_from_file", c.c_void_p, c.c_char_p, c.c_void_p)
    draw = bind(rsvg, "rsvg_handle_render_document", c.c_int, c.c_void_p, c.c_void_p, c.POINTER(Rectangle), c.c_void_p)
    surface_new = bind(cairo, "cairo_image_surface_create", c.c_void_p, c.c_int, c.c_int, c.c_int)
    context_new = bind(cairo, "cairo_create", c.c_void_p, c.c_void_p)
    save = bind(cairo, "cairo_surface_write_to_png", c.c_int, c.c_void_p, c.c_char_p)
    context_free = bind(cairo, "cairo_destroy", None, c.c_void_p)
    surface_free = bind(cairo, "cairo_surface_destroy", None, c.c_void_p)
    unref = bind(gobject, "g_object_unref", None, c.c_void_p)
    source = Path(__file__).resolve().parent.parent / "icon.svg"
    handle = load(bytes(source), None)
    if not handle:
        raise SystemExit("Could not read icon.svg.")
    surface = surface_new(0, size, size)
    context = context_new(surface)
    try:
        if not draw(handle, context, c.byref(Rectangle(0, 0, size, size)), None):
            raise SystemExit("Could not render icon.svg.")
        if save(surface, bytes(output.resolve())):
            raise SystemExit("Could not write icon PNG.")
    finally:
        context_free(context)
        surface_free(surface)
        unref(handle)
    print(f"Exported {output} ({size} x {size})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent.parent / "icon.png")
    parser.add_argument("--size", type=int, choices=range(16, 4097), metavar="16..4096", default=128)
    args = parser.parse_args()
    render(args.output, args.size)
