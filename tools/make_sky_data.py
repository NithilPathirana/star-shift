"""Constellation boundary table (Roman 1987, via Astropy's bundled copy) for the browser,
plus Astropy reference values for tests of web/app/sky.js.
AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026."""
import json
from pathlib import Path
import numpy as np
import astropy.units as u
from astropy.coordinates import SkyCoord, get_constellation, BarycentricMeanEcliptic
import astropy.coordinates as ac

d = Path(ac.__file__).parent / "data"
rows = []
for line in (d / "constellation_data_roman87.dat").read_text().splitlines():
    if line.strip() and not line.startswith("#"):
        a, b, c, n = line.split()
        rows.append([float(a), float(b), float(c), n])
names = {}
for line in (d / "constellation_names.dat").read_text().splitlines():
    if line.strip() and not line.startswith("#"):
        k, v = line.split(None, 1)
        names[k] = v.strip()
names["Oph"] = "Ophiuchus"  # Astropy's list misspells it
root = Path(__file__).resolve().parent.parent
(root / "web" / "app" / "data").mkdir(parents=True, exist_ok=True)
(root / "web" / "app" / "data" / "constellations.json").write_text(json.dumps({"source": "Roman (1987) boundaries, equinox B1875, via Astropy", "rows": rows, "names": names}, separators=(",", ":")))

rng = np.random.default_rng(7)
ra = np.concatenate([rng.uniform(0, 360, 300), [269.4461, 331.0984, 133.7578, 76.9565, 248.1676, 83.822, 0.0, 180.0]])
dec = np.concatenate([np.degrees(np.arcsin(rng.uniform(-1, 1, 300))), [4.7707, -56.8013, -7.242, 30.4014, 66.755, -5.391, 89.9, -89.9]])
c = SkyCoord(ra * u.deg, dec * u.deg, frame="icrs")
g = c.galactic
e = c.transform_to(BarycentricMeanEcliptic(equinox="J2000"))
ref = [{"ra": float(a), "dec": float(b), "l": float(x), "b": float(y), "elon": float(p), "elat": float(q), "con": k}
       for a, b, x, y, p, q, k in zip(ra, dec, g.l.deg, g.b.deg, e.lon.deg, e.lat.deg, get_constellation(c, short_name=True))]
(root / "tests" / "fixtures" / "sky_ref.json").write_text(json.dumps(ref))
print(len(rows), "boundary rows,", len(names), "names,", len(ref), "reference points")
