#!/usr/bin/env python3
"""Draw the placeholder app icon: dark gunmetal plate with a brushed chrome V. Needs Pillow.

    python3 ios/make-icon.py    # writes Vroom/Assets.xcassets/AppIcon.appiconset/icon-1024.png
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

S = 1024
OUT = Path(__file__).parent / "Vroom/Assets.xcassets/AppIcon.appiconset/icon-1024.png"


def vgrad(top, bottom, size=(S, S)):
    w, h = size
    img = Image.new("RGB", size)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return img


# gunmetal plate, lighter at the top, with fine horizontal brushing
plate = vgrad((74, 80, 88), (22, 25, 30))
noise = Image.effect_noise((S, S // 4), 18).resize((S, S)).filter(ImageFilter.BoxBlur(1))
plate = ImageChops.add(plate, Image.merge("RGB", [noise] * 3), scale=1.0, offset=-128)

# soft top sheen
sheen = Image.new("L", (S, S), 0)
ImageDraw.Draw(sheen).ellipse((-200, -620, S + 200, 380), fill=70)
plate = Image.composite(Image.new("RGB", (S, S), (190, 198, 208)), plate, sheen.filter(ImageFilter.GaussianBlur(90)))

# V shape mask
V = [(196, 230), (370, 230), (512, 640), (654, 230), (828, 230), (588, 820), (436, 820)]
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).polygon(V, fill=255)

# drop shadow and dark bevel under the letterform
shadow = Image.new("L", (S, S), 0)
ImageDraw.Draw(shadow).polygon([(x, y + 22) for x, y in V], fill=200)
plate = Image.composite(Image.new("RGB", (S, S), (6, 7, 9)), plate, shadow.filter(ImageFilter.GaussianBlur(18)))
edge = mask.filter(ImageFilter.MaxFilter(15))
plate = Image.composite(Image.new("RGB", (S, S), (12, 13, 16)), plate, edge)

# chrome fill: bright sky band, a hard horizon, dark ground, bright lower rim
chrome = Image.new("RGB", (S, S))
d = ImageDraw.Draw(chrome)
stops = [(230, (250, 252, 255)), (470, (150, 160, 175)), (530, (40, 44, 52)), (690, (120, 128, 140)), (820, (235, 238, 242))]
for y in range(S):
    if y <= stops[0][0]:
        c = stops[0][1]
    elif y >= stops[-1][0]:
        c = stops[-1][1]
    else:
        for (y0, c0), (y1, c1) in zip(stops, stops[1:]):
            if y0 <= y <= y1:
                t = (y - y0) / (y1 - y0)
                c = tuple(round(a + (b - a) * t) for a, b in zip(c0, c1))
                break
    d.line([(0, y), (S, y)], fill=c)
plate = Image.composite(chrome, plate, mask)

# thin highlight on the upper edges
inner = mask.filter(ImageFilter.MinFilter(9))
rim = ImageChops.subtract(mask, inner)
rim_top = Image.composite(rim, Image.new("L", (S, S), 0), vgrad((255,) * 3, (0,) * 3).convert("L"))
plate = Image.composite(Image.new("RGB", (S, S), (255, 255, 255)), plate, rim_top)

OUT.parent.mkdir(parents=True, exist_ok=True)
plate.save(OUT)
print(OUT)
