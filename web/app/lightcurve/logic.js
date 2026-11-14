// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Brightness-vs-date strip for the viewer: the target's brightness in each image, measured
// the same way as the Proof page (tools/make_proof.mjs, DESIGN.md 32):
//  - aperture photometry at the catalogue position on the viewer's aligned frames: the sum of
//    background-subtracted pixels within 2.5 px (align.js centroid, one pass, background =
//    median of a ring 4.5-7.5 px out), in MJy/sr summed over pixels;
//  - turned into mJy with the solid angle of the pixels the sum ran over (each frame carries its
//    pixel size; the viewer's aligned grid is 6.15″);
//  - an image is skipped if any pixel inside the aperture is masked (the archive blanks saturated
//    and bad pixels), so a saturated star gives no number at all, never a wrong one;
//  - two wavelength groups, never averaged together: 0.75-3.8 µm (detectors 1-4) and
//    3.8-5.0 µm (detectors 5-6);
//  - each image is compared only with first-season images from the same detector at the same
//    wavelength (±0.05 µm): Δm = −2.5 log10(F / F_ref). SPHEREx sees a different wavelength in
//    every image, and a star is much brighter at some wavelengths than others, so raw mJy from
//    different images cannot be lined up directly.
// Pure, no DOM. Shared by web/app/lightcurve/index.js and tests/lightcurve.test.mjs.

import { centroid } from '../../core/align.js';
import { meanSem } from '../proof/logic.js';

export const APERTURE = 2.5;   // px, as make_proof.mjs
export const WL_MATCH = 0.05;  // µm, as make_proof.mjs
export const SEASON_GAP = 60;  // days, as data.js seasons()
export const GRID_ARCSEC = 6.15;
export const GROUPS = [
  { id: 'short', name: '0.75–3.8 µm', long: '0.75–3.8 µm (detectors 1–4)', dets: [1, 2, 3, 4] },
  { id: 'long', name: '3.8–5.0 µm', long: '3.8–5.0 µm (detectors 5–6)', dets: [5, 6] },
];
export const CAPTION = 'Aperture photometry on single images, not calibrated.';

// Solid angle of a square pixel of `arcsec` on a side, in steradians.
export const pixelSr = (arcsec) => (arcsec * Math.PI / 648000) ** 2;
// A sum of surface brightness over pixels (MJy/sr per pixel) -> flux in mJy (1 MJy = 1e9 mJy).
export const toMilliJy = (sumMJySr, pixArcsec = GRID_ARCSEC) => sumMJySr * pixelSr(pixArcsec) * 1e9;

// Season index for each frame (frames sorted by date; a gap of 60 days or more starts a new season).
export function seasonIndex(mjds, gap = SEASON_GAP) {
  const order = mjds.map((m, i) => [m, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(mjds.length); let s = -1, last = -Infinity;
  for (const [m, i] of order) { if (m - last >= gap) s++; out[i] = s; last = m; }
  return out;
}

// One row per frame: where the aperture sat, how many of its pixels are masked, and the flux.
// frames: the viewer's raw frames ({ n, data, mjd, detector, wavelengthUm, expected, pixArcsec? }).
export function measure(frames, grid, { aperture = APERTURE } = {}) {
  const c = grid?.c ?? null;
  return frames.map((f, idx) => {
    const [x0, y0] = f.expected || [c ?? (f.n - 1) / 2, c ?? (f.n - 1) / 2];
    let masked = 0, inside = 0;
    for (let j = Math.floor(y0 - aperture); j <= Math.ceil(y0 + aperture); j++) for (let i = Math.floor(x0 - aperture); i <= Math.ceil(x0 + aperture); i++) {
      if (i < 0 || j < 0 || i >= f.n || j >= f.n || Math.hypot(i - x0, j - y0) > aperture) continue;
      inside++; if (!Number.isFinite(f.data[j * f.n + i])) masked++;
    }
    const pix = f.pixArcsec ?? grid?.scale ?? GRID_ARCSEC;
    const cen = masked ? null : centroid(f, x0, y0, aperture, 1);
    const flux = cen?.flux ?? null; // MJy/sr summed over pixels, background removed
    return { idx, mjd: f.mjd, det: f.detector, wl: f.wavelengthUm, masked, inside, pixArcsec: pix, flux, mJy: flux != null ? toMilliJy(flux, pix) : null };
  });
}

// Δm against the first season, per wavelength group. rows from measure().
export function lightcurve(rows) {
  const season = seasonIndex(rows.map(r => r.mjd));
  const nSeasons = rows.length ? Math.max(...season) + 1 : 0;
  const R = rows.map((r, k) => ({ ...r, s: season[k] }));
  const masked = R.filter(r => r.masked > 0).length;
  const groups = GROUPS.map(g => {
    const mine = R.filter(r => g.dets.includes(r.det));
    const gMasked = mine.filter(r => r.masked > 0);
    const usable = mine.filter(r => r.masked === 0 && r.flux > 0 && Number.isFinite(r.wl));
    const faint = mine.filter(r => r.masked === 0 && !(r.flux > 0)).length;
    const firstS = usable.length ? Math.min(...usable.map(r => r.s)) : -1;
    const first = usable.filter(r => r.s === firstS);
    const points = [];
    for (const r of usable) {
      const ref = first.filter(q => q !== r && q.det === r.det && Math.abs(q.wl - r.wl) <= WL_MATCH);
      if (!ref.length) continue;
      const refFlux = ref.reduce((a, q) => a + q.flux, 0) / ref.length;
      points.push({ idx: r.idx, mjd: r.mjd, s: r.s, det: r.det, wl: r.wl, mJy: r.mJy, refMJy: toMilliJy(refFlux, r.pixArcsec), dm: -2.5 * Math.log10(r.flux / refFlux) });
    }
    const bySeason = [...new Set(points.map(p => p.s))].sort((a, b) => a - b).map(s => {
      const ps = points.filter(p => p.s === s), ms = meanSem(ps.map(p => p.dm));
      return { season: s, n: ms.n, dm: ms.mean, sem: ms.sem, from: Math.min(...ps.map(p => p.mjd)), to: Math.max(...ps.map(p => p.mjd)) };
    });
    const a = bySeason[0], b = bySeason[bySeason.length - 1];
    const ok = bySeason.length >= 2 && a.season === firstS && a.n >= 3 && b.n >= 3 && a.sem != null && b.sem != null;
    return {
      ...g, total: mine.length, masked: gMasked.length, faint, noMatch: usable.length - points.length, points, bySeason,
      ok, dmag: ok ? b.dm - a.dm : null, dmagErr: ok ? Math.hypot(a.sem, b.sem) : null,
    };
  });
  const plotted = groups.reduce((a, g) => a + g.points.length, 0);
  const status = !rows.length ? 'empty' : masked === rows.length ? 'saturated' : plotted ? 'ok' : 'none';
  return { total: rows.length, masked, plotted, nSeasons, groups, status };
}

// Plain-language lines for the panel (kept here so the test checks the exact wording).
export function message(lc, name = 'This object') {
  if (lc.status === 'saturated') return `${name} is saturated in every SPHEREx image here, so its brightness cannot be measured.`;
  if (lc.status === 'empty') return 'No images yet.';
  if (lc.status === 'none') return `No image of ${name} has an unmasked centre and a first-season image at the same wavelength to compare with, so no brightness change can be shown.`;
  return null;
}
export function skippedText(lc) {
  const noMatch = lc.groups.reduce((a, g) => a + g.noMatch, 0), faint = lc.groups.reduce((a, g) => a + g.faint, 0);
  const parts = [`${lc.masked} skipped: centre pixels masked`];
  if (noMatch) parts.push(`${noMatch} with no first-season image at the same wavelength`);
  if (faint) parts.push(`${faint} with no light above the background`);
  return `${lc.plotted} of ${lc.total} images plotted · ${parts.join(' · ')}`;
}
// Signed magnitudes with a real minus sign.
export const fmtMag = (v, d = 2) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(d);
