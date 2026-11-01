"""Rebuild checked-in NSIS bitmaps from the app icon and CSS palette. Needs Pillow."""
from pathlib import Path
import re
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "src/styles.css").read_text(encoding="utf-8")
PALETTE = {name: re.search(r"--" + name + r":\s*(#[0-9a-fA-F]{6})", CSS).group(1)
           for name in ("bg", "surface", "surface-2", "border", "text", "text-2", "blue", "blue-soft")}
S = 3


def font(size, bold=False):
    candidates = (["C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/seguisb.ttf"] if bold
                  else ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/segoeui.ttf"])
    for file in candidates:
        if Path(file).exists():
            return ImageFont.truetype(file, round(size * S))
    return ImageFont.truetype("DejaVuSans.ttf", round(size * S))


def image(width, height, color):
    canvas = Image.new("RGB", (width * S, height * S), color)
    return canvas, ImageDraw.Draw(canvas)


def label(draw, xy, text, size, color, bold=False):
    draw.text(tuple(round(v * S) for v in xy), text, fill=color, font=font(size, bold))


def rect(draw, box, radius, color, border=None):
    draw.rounded_rectangle(tuple(round(v * S) for v in box), radius=radius * S,
                           fill=color, outline=border, width=S)


def icon(canvas, xy, size):
    logo = Image.open(ROOT / "src-tauri/icons/128x128.png").convert("RGBA")
    logo = logo.resize((size * S, size * S), Image.Resampling.LANCZOS)
    canvas.paste(logo, tuple(v * S for v in xy), logo)


out = ROOT / "src-tauri/installer"
out.mkdir(exist_ok=True)
side, d = image(164, 314, PALETTE["bg"])
icon(side, (22, 32), 48)
label(d, (23, 91), "Quota", 27, PALETTE["text"], True)
label(d, (24, 136), "你的 AI 用量空间", 10, PALETTE["text-2"])
rect(d, (20, 180, 144, 260), 10, PALETTE["surface"], PALETTE["border"])
rect(d, (27, 188, 54, 252), 5, PALETTE["bg"])
rect(d, (31, 198, 50, 204), 2, PALETTE["blue-soft"])
for y, width in ((211, 15), (220, 19), (229, 12)):
    rect(d, (31, y, 31 + width, y + 3), 1, PALETTE["border"])
for x in (61, 100):
    rect(d, (x, 188, x + 36, 213), 4, PALETTE["surface-2"])
    rect(d, (x + 5, 194, x + 18, 197), 1, PALETTE["border"])
    rect(d, (x + 5, 203, x + 25, 207), 1, PALETTE["blue"])
rect(d, (61, 219, 136, 252), 5, PALETTE["surface-2"])
for y, width in ((227, 57), (236, 40), (244, 49)):
    rect(d, (67, y, 67 + width, y + 2), 1, PALETTE["border"])
label(d, (24, 285), "本地优先 · 从容掌握", 8, PALETTE["text-2"])
side.resize((164, 314), Image.Resampling.LANCZOS).save(out / "sidebar.bmp")
header, d = image(150, 57, PALETTE["surface-2"])
icon(header, (18, 14), 29)
label(d, (55, 16), "Quota", 19, PALETTE["text"], True)
header.resize((150, 57), Image.Resampling.LANCZOS).save(out / "header.bmp")
print("Built Quota NSIS sidebar/header from the application palette and icon")
