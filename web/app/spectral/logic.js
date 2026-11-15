// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Spectral Explorer: pure logic (no DOM). Picks images, measures the target in each cutout
// with aperture photometry, and lays out the chart. Data: NASA SPHEREx via IRSA
// (releases and DOIs: web/data/releases.json).

import { kindMasksOf } from '../archive/logic.js';
import { measure, detection, lightOnSky, GROUPS, GRID_ARCSEC } from '../lightcurve/logic.js';
import { worldToGrid } from '../../core/align.js';

// Is the light in the aperture the target's? (the viewer's a3 rule, lightcurve/logic.js detection:
// light centre more than 1 px from the predicted position = another source). Each cutout has its own
// WCS, so the predicted position and the light centre of each image are put on one 6.15″ sky grid
// around the target first. cuts: { image {nx, ny, data}, wcs, x, y, detector }.
// Returns, per wavelength group with a judgement: { id, name, detect, sky } (sky: lightOnSky).
export function lightCheck(cuts, target) {
  const grid = { ra0: target.ra, dec0: target.dec, c: 0, scale: GRID_ARCSEC };
  const out = [];
  for (const g of GROUPS) {
    const rows = [];
    for (const c of cuts) {
      if (!g.dets.includes(c.detector) || !c.wcs || !c.image || !Number.isFinite(c.x)) continue;
      const { nx, ny, data } = c.image, n = Math.max(nx, ny);
      let sq = data;
      if (nx !== ny) { sq = new Float32Array(n * n).fill(NaN); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) sq[j * n + i] = data[j * nx + i]; }
      const r = measure([{ n, data: sq, mjd: c.mjd, detector: c.detector, expected: [c.x, c.y] }], null)[0];
      const toGrid = (p) => worldToGrid(grid, ...c.wcs.pixToWorld(p[0], p[1]));
      rows.push({ masked: r.masked, at: toGrid(r.at), light: r.light ? toGrid(r.light) : null, snr: r.snr });
    }
    const detect = detection(rows);
    if (detect) out.push({ id: g.id, name: g.name, detect, sky: lightOnSky(detect, grid) });
  }
  return out;
}

export const X_RANGE = { min: 0.74, max: 5.01 }; // µm, the band editor's domain (DESIGN.md 29)
export const FEATURES = [
  { um: 3.05, label: 'H₂O ice 3.05 µm' },
  { um: 4.27, label: 'CO₂ ice 4.27 µm' },
];
export const APERTURES = [
  { id: 'r1.5', label: '1.5 px', rAp: 1.5, rIn: 4, rOut: 7 },
  { id: 'r2', label: '2 px', rAp: 2, rIn: 4, rOut: 7 },
  { id: 'r3', label: '3 px', rAp: 3, rIn: 5, rOut: 8 },
];
export const CUTOUT_DEG = 0.03; // ~17 SPHEREx pixels: room for the 7-8 px background ring
export const PIXEL_ARCSEC = 6.15;

// Evenly spread `max` items over a list (keeps first and last).
export function spreadPick(items, max) {
  if (!max || items.length <= max) return items.slice();
  if (max === 1) return [items[Math.floor(items.length / 2)]];
  return Array.from({ length: max }, (_, k) => items[Math.round((k * (items.length - 1)) / (max - 1))]);
}

// Up to `perDetector` images per detector, spread in time, then interleaved d1,d2,..,d6,d1,..
// so the chart fills in across the whole wavelength range as points arrive.
export function pickImages(images, perDetector, { skip = new Set() } = {}) {
  const by = new Map();
  for (const im of images.slice().sort((a, b) => a.mjdStart - b.mjdStart)) {
    if (skip.has(im.uri)) continue;
    if (!by.has(im.detector)) by.set(im.detector, []);
    by.get(im.detector).push(im);
  }
  const lists = [...by.keys()].sort((a, b) => a - b).map(d => spreadPick(by.get(d), perDetector));
  const out = [];
  for (let k = 0; lists.some(l => k < l.length); k++) for (const l of lists) if (k < l.length) out.push(l[k]);
  return out;
}

export function median(arr) {
  if (!arr.length) return NaN;
  const s = Float64Array.from(arr).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Aperture photometry on a cutout image { nx, ny, data } (MJy/sr per pixel, NaN = masked).
// (x, y): 0-based pixel position of the target. A pixel belongs to the aperture when its
// centre is within rAp; the background is the median of the ring rIn..rOut.
// Returns null when the target is off the cutout or there is not enough good data, else
// { net (aperture sum minus background, MJy/sr summed over the aperture pixels), apSum, bg, bgSigma,
//   nAp, nApValid, nBg, err, partial, idx (aperture pixel indices) }.
export function aperturePhotometry(img, x, y, { rAp = 2, rIn = 4, rOut = 7, minValidFrac = 0.6, minBg = 8 } = {}) {
  const { nx, ny, data } = img;
  if (!(x >= -0.5 && y >= -0.5 && x <= nx - 0.5 && y <= ny - 0.5)) return null;
  const r2a = rAp * rAp, r2i = rIn * rIn, r2o = rOut * rOut;
  let apSum = 0, nAp = 0, nApValid = 0;
  const bg = [], idx = [];
  const i0 = Math.max(0, Math.floor(x - rOut)), i1 = Math.min(nx - 1, Math.ceil(x + rOut));
  const j0 = Math.max(0, Math.floor(y - rOut)), j1 = Math.min(ny - 1, Math.ceil(y + rOut));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d2 = (i - x) ** 2 + (j - y) ** 2, v = data[j * nx + i];
    if (d2 <= r2a) { nAp++; idx.push(j * nx + i); if (Number.isFinite(v)) { apSum += v; nApValid++; } }
    else if (d2 >= r2i && d2 <= r2o && Number.isFinite(v)) bg.push(v);
  }
  if (!nAp || nApValid / nAp < minValidFrac || bg.length < minBg) return null;
  const b = median(bg);
  const sigma = 1.4826 * median(bg.map(v => Math.abs(v - b)));
  const scale = nAp / nApValid; // fill masked aperture pixels with the mean of the good ones
  const net = (apSum - b * nApValid) * scale;
  return { net, apSum, bg: b, bgSigma: sigma, nAp, nApValid, nBg: bg.length, err: sigma * Math.sqrt(nApValid) * scale, partial: nApValid < nAp, idx };
}

// Why aperturePhotometry gave null: 'edge' (target off the cutout), 'masked' (too many bad
// pixels in the aperture, e.g. a saturated star's core has no data) or 'background' (ring too empty).
export function whyNoPhotometry(img, x, y, { rAp = 2, rIn = 4, rOut = 7, minValidFrac = 0.6, minBg = 8 } = {}) {
  const { nx, ny, data } = img;
  if (!(x >= -0.5 && y >= -0.5 && x <= nx - 0.5 && y <= ny - 0.5)) return 'edge';
  let nAp = 0, ok = 0, bg = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const d2 = (i - x) ** 2 + (j - y) ** 2, f = Number.isFinite(data[j * nx + i]);
    if (d2 <= rAp * rAp) { nAp++; if (f) ok++; } else if (d2 >= rIn * rIn && d2 <= rOut * rOut && f) bg++;
  }
  if (!nAp || ok / nAp < minValidFrac) return 'masked';
  return bg < minBg ? 'background' : null;
}

// Solid angle of one pixel (sr) at (x, y) from a WCS with pixToWorld(x, y) -> [ra, dec].
export function pixelSolidAngle(wcs, x, y) {
  const D2R = Math.PI / 180;
  const v = (ra, dec) => [Math.cos(dec * D2R) * Math.cos(ra * D2R), Math.cos(dec * D2R) * Math.sin(ra * D2R), Math.sin(dec * D2R)];
  const [a, b, c] = [wcs.pixToWorld(x, y), wcs.pixToWorld(x + 1, y), wcs.pixToWorld(x, y + 1)].map(p => v(p[0], p[1]));
  const e1 = a.map((q, i) => b[i] - q), e2 = a.map((q, i) => c[i] - q);
  const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return Math.hypot(...cr); // small parallelogram area on the unit sphere
}

// MJy/sr summed over pixels -> mJy (1 MJy = 1e9 mJy).
export const toMilliJy = (sumMJySr, pixSr) => sumMJySr * pixSr * 1e9;

// Problem flags inside the aperture (cosmic rays, overflow, scattered light, other; SOURCE ignored).
export function apertureFlagged(flags, flagNames, idx) {
  if (!flags) return { flagged: false, kinds: [] };
  const m = kindMasksOf(flagNames);
  const kinds = new Set();
  for (const k of idx) {
    const f = flags[k];
    if (!f) continue;
    for (const id of ['cosmic', 'overflow', 'scatter', 'other']) if (f & m[id]) kinds.add(id);
  }
  return { flagged: kinds.size > 0, kinds: [...kinds] };
}

// ---- chart helpers ----------------------------------------------------------------------------
export function niceTicks(lo, hi, count = 5) {
  if (!(hi > lo)) return [lo];
  const step0 = (hi - lo) / count, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= step0) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

export function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const f of [1, 2, 5]) {
    const v = f * 10 ** e;
    if (v >= lo && v <= hi) out.push(v);
  }
  return out;
}

// y range for the visible points: padded min..max (log: positive values only).
export function yRange(values, log = false) {
  const v = values.filter(x => Number.isFinite(x) && (!log || x > 0));
  if (!v.length) return log ? { lo: 1, hi: 10 } : { lo: 0, hi: 1 };
  let lo = Math.min(...v), hi = Math.max(...v);
  if (log) { lo /= 1.6; hi *= 1.6; return { lo, hi }; }
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
  const pad = (hi - lo) * 0.08;
  return { lo: Math.min(lo - pad, lo > 0 ? 0 : lo - pad), hi: hi + pad };
}

export function fmtValue(v) {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || (a > 0 && a < 1e-2)) return v.toExponential(2);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

// ---- CSV ----------------------------------------------------------------------------------------
export function pointsToCSV(points, seasons = [], csvCell = (x) => (x == null ? '' : /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x))) {
  const head = ['date_utc', 'mjd', 'season', 'detector', 'wavelength_um', 'bandwidth_um', 'band', 'flux_mJy', 'flux_err_mJy',
    'aperture_sum_MJy_sr', 'background_MJy_sr', 'aperture_pixels', 'aperture_pixels_used', 'flagged', 'flag_kinds', 'obs_id', 'irsa_fits_url'];
  const rows = points.map(p => [p.iso, p.mjd?.toFixed(6), seasons[p.season]?.label ?? '', p.detector, p.um?.toFixed(4), p.bw?.toFixed(4), p.band ?? '',
    p.mJy?.toPrecision(5), p.errMJy?.toPrecision(3), p.net?.toPrecision(6), p.bg?.toPrecision(5), p.nAp, p.nApValid, p.flagged ? 'yes' : 'no',
    (p.kinds || []).join(' '), p.obsid, p.irsaUrl]);
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
