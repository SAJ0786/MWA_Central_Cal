"""Builds src/assets/pdf-template-bg.jpg from the supplied MWA monthly-calendar
artwork by erasing the month-specific text (Arabic month, month title, year pill,
tagline, table header labels, table rows, page label). The PDF exporter
(src/services/pdfCalendar.js) draws the real text on top of this background.

Usage: python scripts/build-pdf-template.py
Requires: Pillow
"""
from PIL import Image, ImageFilter
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'pdf-template-source.jpg')
OUT = os.path.join(HERE, '..', 'src', 'assets', 'pdf-template-bg.jpg')

im = Image.open(SRC).convert('RGB')
px = im.load()


def avg(points):
    n = len(points)
    return tuple(sum(p[i] for p in points) / n for i in range(3))


def inpaint(x0, y0, x1, y1):
    """Fill [x0,x1)x[y0,y1) by blending horizontal and vertical interpolation of the border colours."""
    out = {}
    for y in range(y0, y1):
        left = avg([px[x, y] for x in range(x0 - 3, x0)])
        right = avg([px[x, y] for x in range(x1, x1 + 3)])
        for x in range(x0, x1):
            tx = (x - x0 + 0.5) / (x1 - x0)
            h = tuple(left[i] * (1 - tx) + right[i] * tx for i in range(3))
            top = avg([px[x, yy] for yy in range(y0 - 3, y0)])
            bot = avg([px[x, yy] for yy in range(y1, y1 + 3)])
            ty = (y - y0 + 0.5) / (y1 - y0)
            v = tuple(top[i] * (1 - ty) + bot[i] * ty for i in range(3))
            out[(x, y)] = tuple(int(round((h[i] + v[i]) / 2)) for i in range(3))
    for k, c in out.items():
        px[k] = c


def hfill(x0, y0, x1, y1):
    """Horizontal-only interpolation (for flat dark-green table header bars)."""
    for y in range(y0, y1):
        left = avg([px[x, y] for x in range(x0 - 3, x0)])
        right = avg([px[x, y] for x in range(x1, x1 + 3)])
        for x in range(x0, x1):
            tx = (x - x0 + 0.5) / (x1 - x0)
            px[x, y] = tuple(int(round(left[i] * (1 - tx) + right[i] * tx)) for i in range(3))


def wipe_glyphs(x0, y0, x1, y1, margin=10, grow=13, blur=5, feather=6):
    """Remove dark/gold strokes by max-filtering (keeps the bright glow), then feather-blend back."""
    global px
    box = (x0 - margin, y0 - margin, x1 + margin, y1 + margin)
    crop = im.crop(box)
    cleaned = crop.filter(ImageFilter.MaxFilter(grow)).filter(ImageFilter.GaussianBlur(blur))
    mask = Image.new('L', crop.size, 0)
    mask.paste(255, (margin, margin, crop.size[0] - margin, crop.size[1] - margin))
    mask = mask.filter(ImageFilter.GaussianBlur(feather))
    im.paste(cleaned, box[:2], mask)
    px = im.load()


def flat(x0, y0, x1, y1, color):
    for y in range(y0, y1):
        for x in range(x0, x1):
            px[x, y] = color


wipe_glyphs(80, 104, 242, 220)  # Arabic month name inside the crescent
inpaint(278, 118, 692, 190)   # month title
inpaint(338, 205, 572, 242)   # year pill text
inpaint(262, 254, 648, 281)   # tagline
hfill(46, 612, 182, 646)      # table header: Islamic Dates
hfill(216, 606, 318, 648)     # table header: MWA Event Date
hfill(520, 614, 632, 646)     # table header: Event
CREAM = (246, 237, 216)
flat(24, 660, 840, 1064, CREAM)  # table rows + page label

os.makedirs(os.path.dirname(OUT), exist_ok=True)
im.save(OUT, quality=92)
print('wrote', os.path.abspath(OUT), im.size)
