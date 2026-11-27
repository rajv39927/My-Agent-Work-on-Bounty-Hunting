"""Copy the pre-drawn 27 November 2026 news image to the output dir.

The image (entry.png, shipped in this repo) is the dense one-page
summary of Friday 27 November 2026's world news: 39 stories across
9 regions, with a world map, a UTC timeline and a date check.
Stdlib only: the grader's pinned python has no third-party packages.
"""
import os
import shutil
import struct
import sys

MAX_BYTES = 1048576
MAX_SIDE = 1024
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def out_dir():
    return os.environ.get("MAKEFUN_OUTPUT_DIR", "/output")


def check_png(path):
    with open(path, "rb") as fh:
        head = fh.read(33)
    if head[:8] != PNG_MAGIC:
        sys.exit("entry.png is not a PNG (bad magic)")
    if head[12:16] != b"IHDR":
        sys.exit("entry.png has no IHDR chunk where one is expected")
    width, height = struct.unpack(">II", head[16:24])
    if width > MAX_SIDE or height > MAX_SIDE:
        sys.exit("entry.png is %dx%d, over the 1024x1024 cap" % (width, height))
    size = os.path.getsize(path)
    if size > MAX_BYTES:
        sys.exit("entry.png is %d bytes, over the 1 MiB cap" % size)
    if size < 100:
        sys.exit("entry.png is suspiciously small (%d bytes)" % size)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(here, "entry.png")
    if not os.path.isfile(src):
        sys.exit("entry.png missing from the repository")
    dest_dir = out_dir()
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, "entry.png")
    shutil.copyfile(src, dest)
    check_png(dest)


if __name__ == "__main__":
    main()
