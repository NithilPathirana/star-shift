"""Display-options comparison sheets for the team (evidence only, not the website).
AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

Reads evidence/display_<key>.json (from tools/display_data.mjs), fetches a 2MASS K-band
reference image from IRSA for the same field, and writes evidence/display_options_<key>.png.
Usage: python tools/display_options.py barnard "Barnard's Star"
"""
import gzip, io, json, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import map_coordinates
from astropy.io import fits
from astropy.wcs import WCS

ROOT = Path(__file__).resolve().parent.parent / "evidence"
key, title = sys.argv[1], sys.argv[2]
J = json.loads((ROOT / f"display_{key}.json").read_text())
G = J["grid"]; N, C, S = G["n"], G["c"], G["scale"]
RA0, DEC0 = G["ra0"], G["dec0"]
P = 340  # panel size in pixels
FONT = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 17)
FONT_B = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 22)
FONT_S = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 14)

def fill_holes(a, passes=6):
    """Display only: fill blank pixels (e.g. saturated star cores the pipeline left empty)
    with the brightest neighbour, so bright stars don't show a black hole."""
    a = a.copy()
    for _ in range(passes):
        bad = ~np.isfinite(a)
        if not bad.any():
            break
        pad = np.pad(a, 1, constant_values=np.nan)
        nb = np.stack([pad[1 + dy:1 + dy + a.shape[0], 1 + dx:1 + dx + a.shape[1]]
                       for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx])
        with np.errstate(all="ignore"):
            mx = np.nanmax(nb, axis=0)
        a[bad & np.isfinite(mx)] = mx[bad & np.isfinite(mx)]
    return a

def coverage(a, arcmin=30):
    raw = np.array([np.nan if v is None else v for v in a], dtype=float).reshape(N, N)
    return np.isfinite(crop(raw, arcmin)).mean()

def arr(a):
    return fill_holes(np.array([np.nan if v is None else v for v in a], dtype=float).reshape(N, N))

def crop(a, arcmin):
    h = int(round(arcmin * 60 / S / 2))
    return a[int(C) - h:int(C) + h + 1, int(C) - h:int(C) + h + 1]

def norm(a, how="asinh", lo_p=1.0, hi_p=99.8):
    a = np.where(np.isfinite(a), a, np.nanmedian(a))
    lo, hi = np.percentile(a, lo_p), np.percentile(a, hi_p)
    x = np.clip((a - lo) / max(hi - lo, 1e-12), 0, 1)
    if how == "asinh":
        x = np.arcsinh(12 * x) / np.arcsinh(12)
    elif how == "log":
        x = np.log10(1 + 300 * x) / np.log10(301)
    return x

def to_img(x, smooth=True, rgb=False):
    mode = "RGB" if rgb else "L"
    im = Image.fromarray((np.clip(x, 0, 1) * 255).astype(np.uint8), mode)
    return im.resize((P, P), Image.LANCZOS if smooth else Image.NEAREST)

def marks(im, frac=0.5):
    """Two small ticks pointing at the target (not covering it)."""
    d = ImageDraw.Draw(im)
    c = P * frac
    for dx, dy in ((1, 0), (0, -1)):
        d.line([(c + dx * 14, c + dy * 14), (c + dx * 30, c + dy * 30)], fill=(255, 90, 80), width=3)
    return im

def fov_label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle([0, P - 22, 8 + d.textlength(text, font=FONT_S), P], fill=(0, 0, 0))
    d.text((4, P - 20), text, fill=(220, 220, 220), font=FONT_S)
    return im

stacks = {int(k): arr(v["data"]) for k, v in J["stacks"].items()}
singles = J["singles"]
# single frame: detector 3 if present (2 um, good for stars), else first
best_det = max(J["stacks"], key=lambda k: J["stacks"][k]["n"])  # detector with most frames
# single frame from that detector covering the most of the 30' field
single = max((s for s in singles if s["det"] == int(best_det)), key=lambda s: coverage(s["data"]))
wide = max(singles, key=lambda s: coverage(s["data"]))  # for the 30' panel
sframe = arr(single["data"])
sdet = single["det"]
stack_same = stacks[sdet]
nstack = J["stacks"][str(sdet)]["n"]
WL = {1: "0.75-1.1 um", 2: "1.1-1.6 um", 3: "1.6-2.4 um", 4: "2.4-3.8 um", 5: "3.8-4.4 um", 6: "4.4-5.0 um"}

def mk(a, arcmin, how="asinh", smooth=True, rgb=False):
    if rgb:
        return marks(fov_label(to_img(a, smooth, rgb=True), f"{arcmin}' wide"))
    return marks(fov_label(to_img(norm(crop(a, arcmin), how), smooth).convert("RGB"), f"{arcmin}' wide"))

# --- 2MASS K reference (same centre, north up, 10') ---
def get(url, tries=4):
    for k in range(tries):
        try:
            return urllib.request.urlopen(url, timeout=120).read()
        except urllib.error.HTTPError as e:
            if e.code not in (502, 503) or k == tries - 1:
                raise
            time.sleep(2 * (k + 1))

def twomass_k(arcmin, n):
    q = f"https://irsa.ipac.caltech.edu/ibe/search/twomass/allsky/allsky?POS={RA0},{DEC0}&SIZE={arcmin / 60}&INTERSECT=OVERLAPS&where=" + urllib.parse.quote("filter='k'")
    rows = [l for l in get(q).decode().splitlines() if l and l[0] not in "\\|"]
    hdr = [h.strip() for h in [l for l in get(q).decode().splitlines() if l.startswith("|")][0].strip("|").split("|")]
    recs = [dict(zip(hdr, r.split())) for r in rows]
    tiles = []
    for rec in recs:
        try:
            tiles.append(one_tile(rec, arcmin, n))
        except Exception as e:
            print("  2MASS tile skipped:", type(e).__name__)
    data = np.nanmean(np.stack([t[0] for t in tiles]), axis=0)
    return data, recs[0]["ordate"]

def one_tile(rec, arcmin, n):
    path = f"{rec['ordate']}{rec['hemisphere']}/s{int(rec['scanno']):03d}/image/{rec['fname']}"
    url = f"https://irsa.ipac.caltech.edu/ibe/data/twomass/allsky/allsky/{path}?center={RA0},{DEC0}&size={arcmin / 60}"
    raw = get(url)
    if raw[:2] == bytes([31, 139]):  # gzip
        raw = gzip.decompress(raw)
    with fits.open(io.BytesIO(raw)) as h:
        data, w = h[0].data.astype(float), WCS(h[0].header)
        ordate = rec["ordate"]
    # sample onto a north-up TAN grid of n x n covering `arcmin`
    sc = arcmin * 60 / n
    j, i = np.mgrid[0:n, 0:n]
    xi = ((n - 1) / 2 - i) * sc / 3600
    eta = ((n - 1) / 2 - j) * sc / 3600
    d0, a0 = np.radians(DEC0), np.radians(RA0)
    xr, er = np.radians(xi), np.radians(eta)
    den = np.cos(d0) - er * np.sin(d0)
    ra = np.degrees(a0 + np.arctan2(xr, den))
    dec = np.degrees(np.arctan2(er * np.cos(d0) + np.sin(d0), np.hypot(xr, den)))
    px, py = w.all_world2pix(ra, dec, 0)
    out = map_coordinates(data - np.nanmedian(data), [py, px], order=1, cval=np.nan)  # level tile backgrounds
    return out, ordate

try:
    ref, ref_date = twomass_k(10, 600)
    ref_img = marks(fov_label(to_img(norm(fill_holes(ref, 2), "asinh", 25, 99.8)).convert("RGB"), "10' wide"))
    then = J.get("pos2mass")
    if then:  # where the target was when 2MASS looked (it has moved since)
        dd = ImageDraw.Draw(ref_img)
        sc = 10 * 60 / P
        cosd = np.cos(np.radians(DEC0))
        x = P / 2 - (then[0] - RA0) * cosd * 3600 / sc
        yv = P / 2 - (then[1] - DEC0) * 3600 / sc
        dd.ellipse([x - 16, yv - 16, x + 16, yv + 16], outline=(255, 210, 60), width=3)
    ref_label = f"Sharper reference: 2MASS K band (2 um), taken 19{ref_date[:2]}/20{ref_date[:2]}"
    yy = int(ref_date[:2])
    ref_label = f"2MASS ({'19' if yy > 50 else '20'}{ref_date[:2]}), sharper" + (": yellow = target then" if J.get("pos2mass") else "")
except Exception as e:  # reference is optional
    ref_img = Image.new("RGB", (P, P), (30, 30, 30))
    ImageDraw.Draw(ref_img).text((10, P // 2), "2MASS reference unavailable", fill=(200, 200, 200), font=FONT)
    ref_label = f"Reference failed: {type(e).__name__}"

# --- colour composite: blue = D1+D2, green = D3+D4, red = D5+D6 (season stacks) ---
def chan(dets, arcmin=10):
    parts = [norm(crop(stacks[d], arcmin), "asinh", 1, 99.8) for d in dets if d in stacks]
    return np.mean(parts, axis=0) if parts else None
b, g, r = chan([1, 2]), chan([3, 4]), chan([5, 6])
rgb = np.dstack([r if r is not None else g, g, b if b is not None else g])

rows = [
    ("A. Pixels", [
        (mk(sframe, 3, smooth=False), "True SPHEREx pixels (blocky)"),
        (mk(sframe, 3, smooth=True), "Smoothed (Lanczos upscaling)"),
    ]),
    ("B. How much sky", [
        (mk(sframe, 3), "3' – what we showed so far"),
        (mk(sframe, 10), "10' – neighbour stars appear"),
        (mk(arr(wide["data"]), 30), "30' – wide view, target is tiny"),
    ]),
    ("C. Brightness scale", [
        (mk(sframe, 10, "linear"), "Linear: only bright stars show"),
        (mk(sframe, 10, "asinh"), "Asinh: bright + faint both show"),
        (mk(sframe, 10, "log"), "Log: faint stuff strongest"),
    ]),
    ("D. One photo vs stack", [
        (mk(sframe, 10), f"One photo ({single['date'][:10]}, {WL[sdet]})"),
        (mk(stack_same, 10), f"Stack of {nstack} photos, same season"),
    ]),
    ("E. Colour + reference", [
        (mk(rgb, 10, rgb=True), "Colour: blue=short, red=long wavelength"),
        (ref_img, ref_label),
    ]),
]

W = 3 * P + 4 * 20 + 190
H = 90 + len(rows) * (P + 60) + 40
sheet = Image.new("RGB", (W, H), (14, 15, 18))
d = ImageDraw.Draw(sheet)
d.text((20, 18), f"{title} – display options (SPHEREx, season {J['seasonStart']} to {J['seasonEnd']})", fill=(240, 240, 240), font=FONT_B)
d.text((20, 52), "North up, east left. Red ticks point at the target. AI-written rendering code; data: NASA/IPAC IRSA (SPHEREx), 2MASS.", fill=(170, 170, 170), font=FONT_S)
y = 90
for name, panels in rows:
    d.text((20, y + P // 2 - 12), name, fill=(240, 240, 240), font=FONT)
    x = 190
    for im, lab in panels:
        sheet.paste(im, (x, y))
        d.text((x, y + P + 6), lab, fill=(225, 225, 225), font=FONT)
        x += P + 20
    y += P + 60
d.text((20, H - 30), f"SPHEREx pixel = 6.15\". Stack = median of the frames from one detector in one ~3-week visit.", fill=(150, 150, 150), font=FONT_S)
out = ROOT / f"display_options_{key}.png"
sheet.save(out, optimize=True)
print("wrote", out, ref_label)
