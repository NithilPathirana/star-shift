"""Build reference values with Astropy so the JavaScript core can be tested against them.
AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

Usage: python tools/make_fixtures.py <full SPHEREx cutout .fits>
Writes tests/fixtures/cutout_3hdu.fits and tests/fixtures/astropy_ref.json
"""
import json, sys
from pathlib import Path
import numpy as np
import astropy.units as u
from astropy.io import fits
from astropy.wcs import WCS
from astropy.coordinates import SkyCoord, Distance
from astropy.time import Time

src = Path(sys.argv[1])
out = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
out.mkdir(parents=True, exist_ok=True)

raw = src.read_bytes()
with fits.open(src) as h:
    # byte offset of the end of HDU 2 (FLAGS)
    info = h.fileinfo(2)
    end = info["datLoc"] + h[2]._data_size
    end = -(-end // 2880) * 2880
    (out / "cutout_3hdu.fits").write_bytes(raw[:end])

    hdr = h[1].header
    w = WCS(hdr)
    ny, nx = h[1].data.shape
    pix = [(x, y) for x in (0, nx // 3, nx - 1, -5.5, nx + 10) for y in (0, ny // 2, ny - 1, -7.25, ny + 3)]
    world = [list(map(float, w.all_pix2world([[x, y]], 0)[0])) for x, y in pix]
    back = [list(map(float, w.all_world2pix([wd], 0, tolerance=1e-10)[0])) for wd in world]
    swcs = WCS(hdr, fobj=h, key="W")
    swcs.sip = None
    wave = [float(swcs.pixel_to_world(x, y)[0].to(u.um).value) for x, y in pix]
    img = h[1].data
    ref = {
        "file": src.name,
        "image_shape": [ny, nx],
        "image_samples": {f"{y},{x}": float(img[y, x]) for y, x in [(0, 0), (ny // 2, nx // 2), (ny - 1, nx - 1), (3, 17)]},
        "flags_samples": {f"{y},{x}": int(h[2].data[y, x]) for y, x in [(0, 0), (ny // 2, nx // 2)]},
        "date_avg": hdr["DATE-AVG"], "mjd_avg": hdr["MJD-AVG"], "detector": hdr["DETECTOR"],
        "pix": pix, "world": world, "roundtrip_pix": back, "wavelength_um": wave,
        "wcs_wave": {"X": h["WCS-WAVE"].data["X"][0].tolist(), "Y": h["WCS-WAVE"].data["Y"][0].tolist(),
                     "VALUES": h["WCS-WAVE"].data["VALUES"][0].tolist()},
    }

# Barnard's Star: SIMBAD (Harvard mirror) values, epoch J2000, propagated by Astropy.
bs = dict(ra=269.4520769586187, dec=4.693364966576667, pmra=-801.551, pmdec=10362.394, plx=546.9759)
c = SkyCoord(ra=bs["ra"] * u.deg, dec=bs["dec"] * u.deg, pm_ra_cosdec=bs["pmra"] * u.mas / u.yr,
             pm_dec=bs["pmdec"] * u.mas / u.yr, distance=Distance(parallax=bs["plx"] * u.mas),
             radial_velocity=0 * u.km / u.s, obstime=Time("J2000"))
prop = []
for mjd in (51544.5, 60902.865, 61200.0, 61360.25):
    p = c.apply_space_motion(new_obstime=Time(mjd, format="mjd"))
    prop.append({"mjd": mjd, "ra": float(p.ra.deg), "dec": float(p.dec.deg)})
ref["barnard"] = {"star": bs, "propagated": prop}
(out / "astropy_ref.json").write_text(json.dumps(ref, indent=1))
print("wrote", out)
