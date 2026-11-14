"""Render evidence/frames_<target>.json into a contact sheet (PNG) and a flip-book (GIF).
AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
Evidence images only (not the website). Each frame: per-frame asinh stretch,
north up / east left, red ring = where the catalogue motion says the star is that day.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent / "evidence"
SCALE = 8

def stretch(a):
    a = np.array([np.nan if v is None else v for v in a], dtype=float)
    lo, hi = np.nanpercentile(a, 2), np.nanpercentile(a, 99.7)
    x = np.clip((a - lo) / max(hi - lo, 1e-12), 0, 1)
    x = np.arcsinh(10 * x) / np.arcsinh(10)
    return np.nan_to_num(x, nan=0.0)

def tile(fr, n, label):
    img = (stretch(fr["data"]).reshape(n, n) * 255).astype(np.uint8)
    im = Image.fromarray(img, "L").resize((n * SCALE, n * SCALE), Image.NEAREST).convert("RGB")
    d = ImageDraw.Draw(im)
    ex, ey = fr["expected"]
    cx, cy = (ex + 0.5) * SCALE, (ey + 0.5) * SCALE
    r = 2.2 * SCALE
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 70, 70), width=2)
    wl = fr.get("wavelengthUm")
    d.text((4, 3), f"{fr['date'][:10]}  D{fr['detector']}" + (f"  {wl:.2f}um" if wl else ""), fill=(255, 255, 120))
    if label:
        d.text((4, n * SCALE - 14), label, fill=(180, 220, 255))
    return im

for f in sorted(ROOT.glob("frames_*.json")):
    j = json.loads(f.read_text())
    n, frames = j["grid"]["n"], j["frames"]
    if not frames:
        print(f.name, "no frames"); continue
    key = f.stem.replace("frames_", "")
    tiles = [tile(fr, n, j["label"]) for fr in frames]
    tiles[0].save(ROOT / f"{key}.gif", save_all=True, append_images=tiles[1:], duration=250, loop=0)
    pick = tiles if len(tiles) <= 40 else [tiles[round(k * (len(tiles) - 1) / 39)] for k in range(40)]
    cols = 8
    rows = -(-len(pick) // cols)
    w, h = pick[0].size
    sheet = Image.new("RGB", (cols * w, rows * h), (20, 20, 20))
    for k, t in enumerate(pick):
        sheet.paste(t, ((k % cols) * w, (k // cols) * h))
    sheet.save(ROOT / f"{key}_sheet.png")
    print(key, len(frames), "frames ->", f"{key}.gif", f"{key}_sheet.png")
