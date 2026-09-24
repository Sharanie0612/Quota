"""生成 AgentPrice 应用图标（苹果风格圆角方块 + 蓝色渐变 + ￥），供 tauri icon 使用。
兼容较老版本的 Pillow（不依赖 rounded_rectangle / textbbox）。"""
import sys

from PIL import Image, ImageDraw, ImageFont

S = 1024
OUT = r"D:\Zcode\projects\AgentPrice\app-icon.png"


def rounded_mask(size, radius):
    """手工拼出圆角矩形蒙版，兼容老版本 Pillow。"""
    m = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(m)
    md.rectangle([radius, 0, size - 1 - radius, size - 1], fill=255)
    md.rectangle([0, radius, size - 1, size - 1 - radius], fill=255)
    r2 = radius * 2
    md.ellipse([0, 0, r2, r2], fill=255)
    md.ellipse([size - 1 - r2, 0, size - 1, r2], fill=255)
    md.ellipse([0, size - 1 - r2, r2, size - 1], fill=255)
    md.ellipse([size - 1 - r2, size - 1 - r2, size - 1, size - 1], fill=255)
    return m


stops = [(0.0, (0x5A, 0xB0, 0xFF)), (0.55, (0x00, 0x71, 0xE3)), (1.0, (0x00, 0x4E, 0xA8))]

grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / float(S - 1)
    color = stops[-1][1] + (255,)
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t0 <= t <= t1:
            k = (t - t0) / (t1 - t0)
            color = tuple(int(c0[j] + (c1[j] - c0[j]) * k) for j in range(3)) + (255,)
            break
    gd.line([(0, y), (S, y)], fill=color)

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
img.paste(grad, (0, 0), rounded_mask(S, int(S * 0.225)))

d = ImageDraw.Draw(img)
font = None
for path in (
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/simhei.ttf",
):
    try:
        font = ImageFont.truetype(path, int(S * 0.58))
        break
    except Exception:
        continue
if font is None:
    font = ImageFont.load_default()

text = "¥"
try:
    bbox = d.textbbox((0, 0), text, font=font)
    w, h, ox, oy = bbox[2] - bbox[0], bbox[3] - bbox[1], bbox[0], bbox[1]
except AttributeError:
    w, h = font.getsize(text)
    ox = oy = 0

d.text(
    ((S - w) / 2.0 - ox, (S - h) / 2.0 - oy - S * 0.015),
    text,
    font=font,
    fill=(255, 255, 255, 255),
)

img.save(OUT)
print("saved %s %s" % (OUT, img.size))
print("Pillow:", getattr(Image, "__version__", "unknown"), "python:", sys.version.split()[0])
