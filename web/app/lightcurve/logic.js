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

import { centroid, gridToWorld } from '../../core/align.js';
import { separationArcsec } from '../../core/motion.js';
import { meanSem } from '../proof/logic.js';
import { seasonBounds, seasonAt } from '../seasons.js';

// Is the target itself in the aperture? (a3) Same centroid as the motion fit (data.js
// measureMotion: 3.5 px radius, S/N above 5, 2 px gate, at least 6 images). If too few images
// show light there (fewer than 6 and fewer than half the unmasked ones), the group is "not detected"; if the light sits on average more than one pixel
// (6.15″) from the predicted position, the aperture is measuring another source, not the target.
export const DET = { radius: 3.5, minSnr: 5, gate: 2, minFrames: 6, offPx: 1 };
export const BLEND_RADIUS = 4; // ″: a catalogued source this close to the light centre explains it

export const APERTURE = 2.5;   // px, as make_proof.mjs
export const WL_MATCH = 0.05;  // µm, as make_proof.mjs
export const SEASON_GAP = 60;  // days, as seasons.js splitSeasons()
export const GRID_ARCSEC = 6.15;
export const GROUPS = [
  { id: 'short', name: '0.75–3.8 µm', long: '0.75–3.8 µm (detectors 1–4)', dets: [1, 2, 3, 4] },
  { id: 'long', name: '3.8–5.0 µm', long: '3.8–5.0 µm (detectors 5–6)', dets: [5, 6] },
];
export const CAPTION = 'Aperture photometry on single images, not calibrated.';
// The aperture's radius on the sky, in the Proof page's words: "a masked pixel within 15″" (2.5 px × 6.15″)
export const AP_ARCSEC = Math.round(APERTURE * GRID_ARCSEC);

// Solid angle of a square pixel of `arcsec` on a side, in steradians.
export const pixelSr = (arcsec) => (arcsec * Math.PI / 648000) ** 2;
// A sum of surface brightness over pixels (MJy/sr per pixel) -> flux in mJy (1 MJy = 1e9 mJy).
export const toMilliJy = (sumMJySr, pixArcsec = GRID_ARCSEC) => sumMJySr * pixelSr(pixArcsec) * 1e9;

// Season index for each frame: the one season source (seasons.js), so the chart's seasons are the viewer's
// and the Proof page's (a gap of 60 days or more starts a season; all-year runs, R Draconis, are split).
// bounds: the viewer's seasons (seasonBounds of every image loaded); default: split these dates.
export function seasonIndex(mjds, bounds = seasonBounds(mjds, SEASON_GAP)) {
  return mjds.map(m => seasonAt(m, bounds));
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
    const lc = masked ? null : centroid(f, x0, y0, DET.radius); // where the light really is (motion-fit settings)
    return { idx, mjd: f.mjd, det: f.detector, wl: f.wavelengthUm, masked, inside, pixArcsec: pix, flux, mJy: flux != null ? toMilliJy(flux, pix) : null,
      at: [x0, y0], light: lc ? [lc.x, lc.y] : null, snr: lc ? lc.snr : null };
  });
}

const median = (a) => { const s = a.slice().sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// rows of one wavelength group -> { state: 'ok' | 'faint' | 'offset', n, hits, offPx, light, at }
// (null when no image has an unmasked centre: nothing to say).
export function detection(rows) {
  const clean = rows.filter(r => r.masked === 0 && r.at);
  if (!clean.length) return null;
  const hits = clean.filter(r => r.light && r.snr > DET.minSnr && Math.hypot(r.light[0] - r.at[0], r.light[1] - r.at[1]) <= DET.gate);
  // most usable images show no light there (a group with only a few unmasked images, e.g. a
  // saturated star, is judged on those few)
  if (hits.length < Math.min(DET.minFrames, clean.length / 2)) return { state: 'faint', n: clean.length, hits: hits.length };
  const dx = median(hits.map(r => r.light[0] - r.at[0])), dy = median(hits.map(r => r.light[1] - r.at[1]));
  const offPx = Math.hypot(dx, dy);
  return {
    state: offPx > DET.offPx ? 'offset' : 'ok', n: clean.length, hits: hits.length, offPx,
    light: [median(hits.map(r => r.light[0])), median(hits.map(r => r.light[1]))],
    at: [median(hits.map(r => r.at[0])), median(hits.map(r => r.at[1]))],
  };
}

// Sky positions (degrees) of the light centre and the predicted target position, and their distance.
export function lightOnSky(d, grid) {
  if (!d?.light || !grid || !Number.isFinite(grid.ra0)) return null;
  const light = gridToWorld(grid, ...d.light), at = gridToWorld(grid, ...d.at);
  return { light, at, offArcsec: separationArcsec(at[0], at[1], light[0], light[1]) };
}

// Gaia rows (resolve.js gaiaCone, around the light centre) -> the brightest source within
// BLEND_RADIUS of the light, with its distance from the predicted target position; or null.
export function pickSource(rows, sky, radius = BLEND_RADIUS) {
  if (!sky) return null;
  const near = (rows || []).filter(r => Number.isFinite(r.g) && separationArcsec(sky.light[0], sky.light[1], r.ra, r.dec) <= radius)
    .sort((a, b) => a.g - b.g)[0];
  return near ? { id: near.id, g: near.g, sepArcsec: separationArcsec(sky.at[0], sky.at[1], near.ra, near.dec) } : null;
}

// Fallback when Gaia does not answer: the Gaia DR3 cone the Proof page saved for this target
// (proof.json extra.neighbours: { id, g, sepArcsec } from the target). Without positions only the
// distance can be matched: a source whose distance from the target is within BLEND_RADIUS of the
// light's own distance from it.
export function pickSaved(neighbours, sky, radius = BLEND_RADIUS) {
  if (!sky) return null;
  const near = (neighbours || []).filter(n => Number.isFinite(n.g) && Number.isFinite(n.sepArcsec) && Math.abs(n.sepArcsec - sky.offArcsec) <= radius)
    .sort((a, b) => a.g - b.g)[0];
  return near ? { id: near.id, g: near.g, sepArcsec: near.sepArcsec } : null;
}

// The summary row for a group whose target is not detected (wording checked by the tests).
// name + where (e.g. 'WISE 0855', 'below 3.8 µm'): say whose light it is not (Idea Generation's wording).
export function notHereText(d, sky, src, name, where) {
  if (d?.state === 'faint') return 'Not detected here: no light above the noise at its position';
  const inside = src && name && src.sepArcsec <= APERTURE * GRID_ARCSEC // the same star blends into every band (Master's honesty fix)
    ? ` That star sits inside the ${AP_ARCSEC}″ measuring circle at every wavelength, so the 3.8–5.0 µm light is ${name} blended with some of that star's light.` : '';
  if (src) return `Not detected here: the light is a background star (Gaia G ${src.g.toFixed(1)}, ${src.sepArcsec.toFixed(1)}″ away)${name && where ? `; ${name} is too faint ${where}.` : ''}${inside}`;
  return `Not detected here: the light in the aperture is centred ${sky ? `${sky.offArcsec.toFixed(1)}″` : `${(d.offPx * GRID_ARCSEC).toFixed(0)}″`} away, on another source`;
}

// Δm against the first season, per wavelength group. rows from measure().
export function lightcurve(rows, bounds) {
  const season = seasonIndex(rows.map(r => r.mjd), bounds || undefined);
  const nSeasons = rows.length ? Math.max(...season) + 1 : 0;
  const R = rows.map((r, k) => ({ ...r, s: season[k] }));
  const masked = R.filter(r => r.masked > 0).length;
  const groups = GROUPS.map(g => {
    const mine = R.filter(r => g.dets.includes(r.det));
    const gMasked = mine.filter(r => r.masked > 0);
    const detect = detection(mine), absent = !!detect && detect.state !== 'ok';
    const measurable = mine.filter(r => r.masked === 0 && r.flux > 0 && Number.isFinite(r.wl));
    const usable = absent ? [] : measurable; // not the target's light: plot nothing for this group
    const notHere = absent ? measurable.length : 0;
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
      ...g, total: mine.length, masked: gMasked.length, faint, noMatch: usable.length - points.length, points, bySeason, detect, absent, notHere,
      ok, dmag: ok ? b.dm - a.dm : null, dmagErr: ok ? Math.hypot(a.sem, b.sem) : null,
    };
  });
  const plotted = groups.reduce((a, g) => a + g.points.length, 0);
  const absentAll = groups.every(g => !g.total || g.absent) && groups.some(g => g.absent);
  const status = !rows.length ? 'empty' : masked === rows.length ? 'saturated' : plotted ? 'ok' : absentAll ? 'absent' : 'none';
  return { total: rows.length, masked, plotted, nSeasons, groups, status };
}

// a9: the saturated dead end, with where to go instead (counts from the data).
export function saturatedNote(lc, name = '') {
  if (lc?.status !== 'saturated') return null;
  const all = lc.total === 1 ? 'the one image' : `all ${lc.total} images`;
  const links = [];
  if (!/^RW Aur/i.test(name)) links.push({ text: 'See RW Aurigae →', href: 'index.html?q=RW%20Aurigae&scene=viewer' });
  links.push({ text: 'How we know →', href: 'proof.html' });
  return { text: `Too bright for SPHEREx: the centre is saturated in ${all}, so its brightness can't be measured here.`, links };
}

// Plain-language lines for the panel (kept here so the test checks the exact wording).
export function message(lc, name = 'This object') {
  if (lc.status === 'saturated') return `${name} is saturated in every SPHEREx image here, so its brightness cannot be measured.`;
  if (lc.status === 'empty') return 'No images yet.';
  if (lc.status === 'absent') return `${name} is not detected at its predicted position in these SPHEREx images, so its brightness cannot be measured.`;
  if (lc.status === 'none') return `No image of ${name} has an unmasked centre and a first-season image at the same wavelength to compare with, so no brightness change can be shown.`;
  return null;
}
export function skippedText(lc) {
  const noMatch = lc.groups.reduce((a, g) => a + g.noMatch, 0), faint = lc.groups.reduce((a, g) => a + g.faint, 0);
  const notHere = lc.groups.reduce((a, g) => a + (g.notHere || 0), 0);
  const parts = [`${lc.masked} skipped: a masked pixel within ${AP_ARCSEC}″`];
  if (noMatch) parts.push(`${noMatch} with no first-season image at the same wavelength`);
  if (faint) parts.push(`${faint} with no light above the background`);
  if (notHere) parts.push(`${notHere} where the light is not the target's`);
  return `${lc.plotted} of ${lc.total} images plotted · ${parts.join(' · ')}`;
}
// Signed magnitudes with a real minus sign.
export const fmtMag = (v, d = 2) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(d);
