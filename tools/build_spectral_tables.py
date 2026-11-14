"""Fetch the SPHEREx WCS-WAVE lookup table for each detector (1-6) once and save it
as web/core/data/spectral_wcs.json, so the browser never has to download the 4 MB
full cutout just to know the wavelength. Checks that tables agree across releases.
AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
"""
import io, json, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path
from astropy.io import fits
from astropy.table import Table

IRSA = "https://irsa.ipac.caltech.edu"
RA, DEC = 269.4461, 4.7707  # any position works; Barnard's Star field

def get(url, tries=6):
    for k in range(tries):
        try:
            return urllib.request.urlopen(url, timeout=180).read()
        except urllib.error.HTTPError as e:  # IRSA cutouts return 503 intermittently
            if e.code != 503 or k == tries - 1:
                raise
            time.sleep(2 * (k + 1))

def tap(q):
    url = f"{IRSA}/TAP/sync?FORMAT=csv&QUERY=" + urllib.parse.quote(q)
    return Table.read(get(url).decode(), format="ascii.csv")

rows = tap(f"""SELECT a.uri, p.energy_bandpassname FROM spherex.artifact a JOIN spherex.plane p
  ON a.planeid = p.planeid WHERE 1 = CONTAINS(POINT('ICRS', {RA}, {DEC}), p.poly)
  ORDER BY p.time_bounds_lower""")
out, seen = {}, {}
for r in rows:
    det = int(str(r["energy_bandpassname"]).replace("SPHEREx-D", ""))
    rel = str(r["uri"]).split("/")[3]  # qr / qr2 / dr1 ...
    if (det, rel) in seen:
        continue
    url = f"{IRSA}/{r['uri']}?center={RA},{DEC}d&size=0.05"
    if len(seen) >= 12:
        break
    try:
        raw = get(url)
    except urllib.error.HTTPError as e:
        print(f"skip detector {det} {rel}: HTTP {e.code}")
        continue
    with fits.open(io.BytesIO(raw)) as h:
        w = h["WCS-WAVE"]
        cal = [str(x) for x in w.header.get("HISTORY", []) if "Calibration source" in str(x)]
        tab = {"X": w.data["X"][0].tolist(), "Y": w.data["Y"][0].tolist(),
               "VALUES": [[[round(float(v), 6) for v in px] for px in row] for row in w.data["VALUES"][0]],
               "calibration": cal[0].split(":")[-1].strip() if cal else None}
    seen[(det, rel)] = tab
    if str(det) in out and out[str(det)]["VALUES"] != tab["VALUES"]:
        print(f"NOTE detector {det}: table differs in release {rel} ({tab['calibration']})")
    out.setdefault(str(det), tab)
    print(det, rel, tab["calibration"])
    if len(out) == 6 and len(seen) >= 6 and all(any(k[0] == d for k in seen) for d in range(1, 7)):
        pass
p = Path(__file__).resolve().parent.parent / "web" / "core" / "data" / "spectral_wcs.json"
p.write_text(json.dumps(out, separators=(",", ":")))
print("wrote", p, sorted(out), {k: v["calibration"] for k, v in out.items()})
