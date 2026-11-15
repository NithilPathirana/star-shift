// Bakes Spot's "Known asteroid" example: the eight SPHEREx images of the 14 Dec 2025 visit in which JPL
// PREDICTS asteroid 1354 Botha (exposures 2025W50_2A_0717_1-4, detectors 3 and 6; tools/botha_check.mjs),
// cut to Spot's 25 x 25 grid of 6.15″ pixels centred on Botha's mean predicted place, with JPL Horizons'
// predicted place at each image's mid-time (seen from SPHEREx, from web/data/botha-check.json).
// Same cleaning as the app (irsa.js maskBadPixels, align.js reproject, wave.js wavelengthAt).
// Writes web/data/spot-botha.json, which Spot reads offline (no network). The file records every source.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Usage: node tools/spot_botha_bake.mjs [relay base, default http://127.0.0.1:8787]
import { readFileSync, writeFileSync } from 'node:fs';
import { listImagesSIA, fetchCutout, maskBadPixels, exposureOf, BAD_PIXEL_FLAGS } from '../web/core/irsa.js';
import { configurePrebaked } from '../web/core/prebaked.js';
import { makeGrid, reproject, worldToGrid } from '../web/core/align.js';
import { wavelengthAt } from '../web/core/wave.js';
import { NEO_DEFAULT_VIEW } from '../web/app/neo/sb-ident.js';

const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
configurePrebaked({ manifestUrl: `${BASE}/prebaked/manifest.json`, fileBase: `${BASE}/prebaked/`, origin: BASE });
const check = JSON.parse(readFileSync(new URL('../web/data/botha-check.json', import.meta.url), 'utf8'));
const tables = JSON.parse(readFileSync(new URL('../web/core/data/spectral_wcs.json', import.meta.url), 'utf8'));
const CUT_DEG = 0.06, FOV_ARCSEC = 150;

const images = await listImagesSIA(NEO_DEFAULT_VIEW.ra, NEO_DEFAULT_VIEW.dec, { base: BASE });
const want = new Set(check.exposures.map(e => e.image)); // '2025W50_2A_0717_1 D3'
const visit = images.filter(im => want.has(`${exposureOf(im.uri)} D${im.detector}`));
if (visit.length !== want.size) throw new Error(`found ${visit.length} of ${want.size} images`);
const mean = check.exposures.reduce((a, e) => ({ ra: a.ra + e.predicted.ra / want.size, dec: a.dec + e.predicted.dec / want.size }), { ra: 0, dec: 0 });
const grid = makeGrid(+mean.ra.toFixed(6), +mean.dec.toFixed(6), FOV_ARCSEC, 6.15);
const frames = [];
for (const im of visit) {
  const e = check.exposures.find(x => x.image === `${exposureOf(im.uri)} D${im.detector}`);
  const raw = await fetchCutout(im.uri, grid.ra0, grid.dec0, CUT_DEG, { base: BASE, retries: 8 });
  // OUTLIER is left unmasked here: the pipeline marks 1-3 pixels of the moving asteroid OUTLIER in every
  // image (it differs from the still sky), so the app's usual mask would blank the object itself.
  const c = maskBadPixels(raw, { names: BAD_PIXEL_FLAGS.filter(n => n !== 'OUTLIER') }), f = reproject(c, grid);
  const [px, py] = c.wcs.worldToPix(e.predicted.ra, e.predicted.dec);
  const wl = wavelengthAt(c.header, tables[String(c.detector)], px, py);
  const [gx, gy] = worldToGrid(grid, e.predicted.ra, e.predicted.dec);
  frames.push({
    image: e.image, exposure: exposureOf(im.uri), detector: c.detector, obsid: c.obsid, uri: im.uri, utc: e.utc, mjd: c.mjd,
    wavelengthUm: +wl.wavelength.toFixed(4), predicted: { ra: e.predicted.ra, dec: e.predicted.dec, x: +gx.toFixed(3), y: +gy.toFixed(3) }, vmag: e.vmag,
    unit: c.header.BUNIT ?? 'MJy/sr',
    data: Array.from(f.data, v => (Number.isFinite(v) ? +v.toPrecision(5) : null)),
  });
}
frames.sort((a, b) => a.mjd - b.mjd || a.detector - b.detector);
const out = {
  about: "Spot's 'Known asteroid' example: the SPHEREx images of the visit in which JPL predicts asteroid 1354 Botha, cut to Spot's grid. Made by tools/spot_botha_bake.mjs (AI-written, Claude, Anthropic, for team Proper Motion).",
  generated: new Date().toISOString(),
  object: check.object, date: check.date,
  sources: {
    images: 'NASA SPHEREx spectral images via the NASA/IPAC Infrared Science Archive (IRSA): Quick Release / Data Release images as listed by IRSA SIA for the Asteroids page field (DOIs 10.26131/IRSA678, 10.26131/IRSA662); cutouts through the app relay, cleaned with the app\'s own bad-pixel mask and reprojected to 6.15″ pixels, north up',
    predicted: `JPL Horizons, ${check.method.ephemeris} (web/data/botha-check.json, generated ${check.generated})`,
    seenCheck: `web/data/botha-check.json: ${check.summary.seen} of ${check.summary.measured} images show a dot at the predicted place (rule: ${check.method.rule}); control images ${check.control.seen} of ${check.control.measured}`,
    mask: "the app's bad-pixel mask (irsa.js maskBadPixels) without OUTLIER: the pipeline marks 1-3 pixels of the moving asteroid OUTLIER in every image, so the usual mask would blank the object itself",
  },
  check: { seen: check.summary.seen, measured: check.summary.measured, controlSeen: check.control.seen, controlMeasured: check.control.measured, controlMonths: check.control.months, verdict: check.verdict, rule: check.method.rule },
  grid: { ra0: grid.ra0, dec0: grid.dec0, n: grid.n, scale: grid.scale },
  frames,
};
writeFileSync(new URL('../web/data/spot-botha.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`wrote web/data/spot-botha.json: ${frames.length} images, grid ${grid.n} x ${grid.n}`);
for (const f of frames) console.log(f.image, f.utc, `λ ${f.wavelengthUm} µm`, `pred (${f.predicted.x}, ${f.predicted.y})`);
