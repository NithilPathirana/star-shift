// Data pipeline for the viewer: name -> position -> SPHEREx image list -> aligned frames.
// No DOM here, so the same code runs in the browser and in Node (tools/prebake.mjs),
// which means pre-baked targets hit exactly the same cached URLs as the app.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { listImages, fetchCutout, fetchCutoutLayers, maskBadPixels, mapLimit } from '../core/irsa.js';
import { prebakedFetch } from '../core/prebaked.js'; // the five demo targets answer from web/prebaked/ (Claude)
import { airglowOf, kindMasks, countKinds } from '../core/contam.js';
import { resolveName } from '../core/resolve.js';
import { propagate, mjdToDate, parallaxShift } from '../core/motion.js';
import { makeGrid, reproject, worldToGrid, gridToWorld, stackFrames, centroid, fitLine } from '../core/align.js';
import { tanProject } from '../core/wcs.js';
import { mjdToEpochYear } from '../core/motion.js';
import { wavelengthAt } from '../core/wave.js';
import { findPreset } from './presets.js';

export const BANDS = {
  1: '0.75–1.09 µm', 2: '1.10–1.62 µm', 3: '1.63–2.41 µm', 4: '2.42–3.82 µm', 5: '3.83–4.41 µm', 6: '4.42–5.00 µm',
};
const PIXEL = 6.15; // arcsec

// Evenly spread `max` items over a time-sorted list (0 = all).
export function spread(items, max) {
  if (!max || items.length <= max) return items.slice();
  return Array.from({ length: max }, (_, k) => items[Math.round((k * (items.length - 1)) / (max - 1))]);
}

// Cutout side (deg) that still fills a north-up square of `fovArcmin` at any rotation.
export function cutoutSizeDeg(fovArcmin) {
  return +Math.min(0.5, (fovArcmin / 60) * Math.SQRT2 + (3 * PIXEL) / 3600).toFixed(4);
}

// Deterministic cutout centre: where the target is on that image's date (rounded so the
// URL - and therefore the cache - is stable between the app and the pre-bake script).
export function cutoutCenter(target, mjd) {
  const p = (target.pmra || target.pmdec) ? propagate(target, mjd) : target;
  return { ra: +p.ra.toFixed(5), dec: +p.dec.toFixed(5) };
}

// Group time-sorted frames into observing seasons (SPHEREx revisits about every 6 months).
export function seasons(frames, gapDays = 60) {
  const out = [];
  for (const f of frames) {
    const s = out[out.length - 1];
    if (s && f.mjd - s.endMjd < gapDays) { s.frames.push(f); s.endMjd = f.mjd; } else out.push({ frames: [f], startMjd: f.mjd, endMjd: f.mjd });
  }
  return out;
}

export function buildStacks(frames) {
  return seasons(frames).map(s => {
    const st = stackFrames(s.frames);
    const mid = s.frames.reduce((a, f) => a + f.mjd, 0) / s.frames.length;
    const ex = s.frames.filter(f => f.expected).map(f => f.expected);
    return {
      kind: 'stack', n: st.n, data: st.data, count: s.frames.length, mjd: mid,
      startDate: mjdToDate(s.startMjd), endDate: mjdToDate(s.endMjd),
      detectors: [...new Set(s.frames.map(f => f.detector))].sort(),
      expected: ex.length ? [ex.reduce((a, e) => a + e[0], 0) / ex.length, ex.reduce((a, e) => a + e[1], 0) / ex.length] : null,
    };
  });
}

export async function resolveTarget(query, { fetchFn = prebakedFetch, signal } = {}) {
  if (query.type === 'coords') return { name: null, ra: query.ra, dec: query.dec, pmra: 0, pmdec: 0, epoch: 2000, source: 'coordinates' };
  const preset = findPreset(query.name);
  if (preset) return { ...preset.target, presetKey: preset.key };
  let t;
  try {
    t = await resolveName(query.name, { fetchFn, signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const err = new Error('The star-name service (SIMBAD) is not answering. Try again, or type coordinates instead.');
    err.retryable = true;
    throw err;
  }
  if (!t) { const err = new Error(`No star called "${query.name}" was found in SIMBAD. Check the spelling, or type coordinates.`); err.notFound = true; throw err; }
  return t;
}

// Images to load for these settings (time-sorted). `all` = every image covering the spot.
export async function planImages(target, settings, { base, fetchFn = prebakedFetch, signal } = {}) {
  const mid = (target.pmra || target.pmdec) ? propagate(target, 61000) : target; // ~2025.9, inside the survey
  const all = await listImages(mid.ra, mid.dec, { base, fetchFn, signal });
  const byBand = settings.band === 'all' ? all : all.filter(im => String(im.detector) === String(settings.band));
  const chosen = spread(byBand, settings.max);
  return { all, chosen };
}

// Grid centred on the target at the middle of the chosen images' dates.
export function gridFor(target, chosen, fovArcmin) {
  const midMjd = chosen.length ? (chosen[0].mjdStart + chosen[chosen.length - 1].mjdStart) / 2 : 61000;
  const c = (target.pmra || target.pmdec) ? propagate(target, midMjd) : target;
  return makeGrid(c.ra, c.dec, fovArcmin * 60, PIXEL);
}

// Download, clean and align one image. Returns a frame object for the viewer.
export async function loadFrame(im, target, grid, settings, { base, fetchFn = prebakedFetch, signal, tables, onRetry } = {}) {
  const c0 = cutoutCenter(target, im.mjdStart);
  const countingFetch = async (url, opts) => {
    const res = await fetchFn(url, opts);
    if (res.status === 503 || res.status === 429) onRetry?.();
    return res;
  };
  const raw = await fetchCutout(im.uri, c0.ra, c0.dec, cutoutSizeDeg(settings.fov), { base, fetchFn: countingFetch, signal });
  const c = maskBadPixels(raw);
  const f = reproject(c, grid);
  const moving = !!(target.pmra || target.pmdec);
  const pos = moving ? propagate(target, c.mjd) : target;
  const [px, py] = c.wcs.worldToPix(pos.ra, pos.dec);
  const tab = tables?.[String(c.detector)];
  const wl = tab ? wavelengthAt(c.header, tab, px, py) : null;
  const masks = kindMasks(c.flagNames);
  const W = {}; for (const k of ['CRVAL1W', 'CRVAL2W', 'CDELT1W', 'CDELT2W', 'CRPIX1W', 'CRPIX2W']) W[k] = c.header[k];
  return {
    kind: 'frame', n: f.n, data: f.data, mjd: c.mjd, date: c.date, detector: c.detector, obsid: c.obsid,
    wavelengthUm: wl?.wavelength ?? null, bandwidthUm: wl?.bandwidth ?? null, maskedPixels: c.maskedPixels ?? 0,
    expected: moving ? worldToGrid(grid, pos.ra, pos.dec) : null, uri: im.uri, version: c.version,
    // annual parallax [east, north] arcsec on this date (catalogue parallax), removed by measureMotion
    plxShift: target.plx > 0 ? parallaxShift(pos.ra, pos.dec, target.plx, c.mjd) : null,
    // contamination (DESIGN.md 23): the FLAGS plane on the display grid, its bit names, kind masks/counts, airglow
    flags: f.flags, flagNames: c.flagNames, masks, counts: countKinds(f.flags, masks, f.data),
    glow: airglowOf({ ...c.header, DETECTOR: c.detector }, wl?.wavelength, wl?.bandwidth),
    // what the lazy layer fetch and the WAVE map need: same cutout centre/size, WCS, -TAB keywords
    cut: { ra: c0.ra, dec: c0.dec, size: cutoutSizeDeg(settings.fov), wcs: c.wcs, W, unit: c.header.BUNIT ?? null },
  };
}

// VARIANCE + ZODI for one frame, fetched only when the user asks for those layers
// (5-HDU cutout variant, cached separately by the relay). Returns grid arrays or null.
export async function loadLayers(frame, grid, { base, fetchFn = prebakedFetch, signal } = {}) {
  const c = await fetchCutoutLayers(frame.uri, frame.cut.ra, frame.cut.dec, frame.cut.size, { base, fetchFn, signal });
  const on = (img) => (img ? reproject({ wcs: c.wcs, image: img, flags: null }, grid).data : null);
  return { variance: on(c.variance), zodi: on(c.zodi), units: c.units };
}

// Per-pixel wavelength (µm) on the display grid, from the -TAB lookup (wave.js).
export function waveMap(frame, grid, tables) {
  const tab = tables?.[String(frame.detector)];
  if (!tab || !Number.isFinite(frame.cut?.W?.CRPIX1W)) return null;
  const n = grid.n, out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [ra, dec] = gridToWorld(grid, i, j);
    const [x, y] = frame.cut.wcs.worldToPix(ra, dec);
    out[j * n + i] = wavelengthAt(frame.cut.W, tab, x, y).wavelength;
  }
  return out;
}

// Whole pipeline with events: RESOLVED, PLANNED, FRAME, FRAME_FAILED, RETRY_WAIT, DONE, ERROR, NOT_FOUND.
export async function run(query, settings, { base, fetchFn = prebakedFetch, signal, tables, emit, concurrency = 10 }) {
  let target;
  try {
    target = await resolveTarget(query, { fetchFn, signal });
  } catch (e) {
    if (e.name === 'AbortError') return;
    emit(e.notFound ? { type: 'NOT_FOUND', message: e.message } : { type: 'ERROR', message: e.message, retryable: true });
    return;
  }
  emit({ type: 'RESOLVED', target });
  let plan;
  try {
    plan = await planImages(target, settings, { base, fetchFn, signal });
  } catch (e) {
    if (e.name === 'AbortError') return;
    emit({ type: 'ERROR', message: 'Could not get the list of SPHEREx images from IRSA. It may be busy or offline; try again.', retryable: true });
    return;
  }
  const { all, chosen } = plan;
  const grid = gridFor(target, chosen, settings.fov);
  emit({ type: 'PLANNED', plan: {
    total: all.length, inBand: settings.band === 'all' ? all.length : all.filter(im => String(im.detector) === String(settings.band)).length,
    planned: chosen.length, grid, mjds: chosen.map(im => im.mjdStart),
    firstDate: all.length ? mjdToDate(all[0].mjdStart) : null, lastDate: all.length ? mjdToDate(all[all.length - 1].mjdStart) : null,
  } });
  if (!chosen.length) return;
  await mapLimit(chosen, concurrency, async (im) => {
    if (signal?.aborted) return;
    try {
      const frame = await loadFrame(im, target, grid, settings, { base, fetchFn, signal, tables, onRetry: () => emit({ type: 'RETRY_WAIT' }) });
      if (!signal?.aborted) emit({ type: 'FRAME', frame });
    } catch (e) {
      if (e.name !== 'AbortError' && !signal?.aborted) emit({ type: 'FRAME_FAILED', error: String(e.message || e) });
    }
  });
  if (!signal?.aborted) emit({ type: 'DONE' });
}

// Measure the target's motion from the frames themselves, independently of any catalogue
// proper motion (works for coordinate searches too). Steps:
//  1. seed: stack the first ~60 days of frames and centroid the brightest source near the
//     grid centre (or near the catalogue prediction, when frames carry `expected`);
//  2. track: walk the frames in time order, centroiding each one around the position
//     predicted from the frames already measured (a 2 px gate drops misfits and other stars);
//  3. fit east/north offsets against time -> mas/yr (fitTrack below): annual parallax removed
//     first (frames carry `plxShift` from the catalogue parallax), each image weighted by how
//     well images of its kind are measured, one outlier-clipping pass;
//  4. systematic floor: the same tracking and fit on non-moving field stars in the same images
//     (fieldFloor below); their scatter beyond their own error bars is the floor, which is
//     added in quadrature to the statistical error.
// Accepts any subset of frames, in any order (e.g. only those the contamination filter keeps).
// Returns { ok, frames, span, pmra, pmdec, pmraErr, pmdecErr, total, totalErr, seeded, points,
//   statErr, sysErr, refStars, fit, significant, floor, upperLimit }. totalErr/pmraErr/pmdecErr
//   include the systematic floor; statErr is the statistical part alone.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
export function measureMotion(frames, grid, { radius = 3.5, minSnr = 5, minFrames = 6, gate = 2, searchRadius = 5, seedDays = 60 } = {}) {
  const fs = (frames || []).filter(f => f && f.data && Number.isFinite(f.mjd)).slice().sort((a, b) => a.mjd - b.mjd);
  if (fs.length < minFrames) return { frames: 0, ok: false, reason: 'too few frames' };
  // 1. seed position from the first season's median stack
  let seed = null, seeded = 'blind';
  for (let s = 0; s < fs.length && !seed; ) {
    const season = [];
    let k = s;
    while (k < fs.length && fs[k].mjd <= fs[s].mjd + seedDays) season.push(fs[k++]);
    const ex = season.filter(f => Array.isArray(f.expected) && f.expected.every(Number.isFinite));
    const around = ex.length
      ? [ex.reduce((a, f) => a + f.expected[0], 0) / ex.length, ex.reduce((a, f) => a + f.expected[1], 0) / ex.length]
      : [grid.c, grid.c];
    const st = stackFrames(season);
    let best = -Infinity, bx = around[0], by = around[1];
    for (let j = Math.floor(around[1] - searchRadius); j <= Math.ceil(around[1] + searchRadius); j++) {
      for (let i = Math.floor(around[0] - searchRadius); i <= Math.ceil(around[0] + searchRadius); i++) {
        if (i < 0 || j < 0 || i >= st.n || j >= st.n || Math.hypot(i - around[0], j - around[1]) > searchRadius) continue;
        const v = st.data[j * st.n + i];
        if (Number.isFinite(v) && v > best) { best = v; bx = i; by = j; }
      }
    }
    const c = best > -Infinity ? centroid(st, bx, by, radius) : null;
    if (c && c.snr > minSnr && Math.hypot(c.x - bx, c.y - by) <= gate) { seed = [c.x, c.y]; seeded = ex.length ? 'catalogue' : 'blind'; }
    s = k;
  }
  if (!seed) return { frames: 0, ok: false, reason: 'no clear source near the centre' };
  // 2. track frame by frame from the last measured positions
  const acc = [];
  const predict = (t) => {
    if (!acc.length) return seed;
    const ts = acc.map(p => p.t);
    if (acc.length >= 4 && Math.max(...ts) - Math.min(...ts) > 0.3) {
      const fx = fitLine(ts, acc.map(p => p.x)), fy = fitLine(ts, acc.map(p => p.y));
      return [fx.a + fx.b * t, fy.a + fy.b * t];
    }
    const last = acc.slice(-3);
    const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
    return [med(last.map(p => p.x)), med(last.map(p => p.y))];
  };
  for (const f of fs) {
    const t = mjdToEpochYear(f.mjd);
    const [sx, sy] = predict(t);
    const c = centroid(f, sx, sy, radius);
    if (!c || !(c.snr > minSnr) || Math.hypot(c.x - sx, c.y - sy) > gate) continue;
    acc.push(trackPoint(f, grid, c, t, f.plxShift));
  }
  // 3. weighted straight-line fit, parallax removed
  if (acc.length < minFrames) return { frames: acc.length, ok: false, seeded };
  const T = fitTrack(acc, minFrames);
  const span = Math.max(...T.pts.map(p => p.t)) - Math.min(...T.pts.map(p => p.t));
  if (span < 0.3) return { frames: T.pts.length, ok: false, span, seeded };
  const { fe, fn } = T;
  const pmra = fe.b * 1000, pmdec = fn.b * 1000, se = fe.sigmaB * 1000, sn = fn.sigmaB * 1000;
  const total = Math.hypot(pmra, pmdec);
  const proj = (a, b) => (total > 0 ? Math.hypot(pmra * a, pmdec * b) / total : Math.hypot(a, b));
  // 4. systematic floor from field stars (per axis, mas/yr), never below the documented minimum
  const field = fieldFloor(fs, grid, acc, { radius, minSnr, minFrames });
  const sys = field.n >= 3 ? Math.max(SYS_FLOOR_MASYR, field.sys) : SYS_FLOOR_MASYR;
  const totalErrFull = proj(Math.hypot(se, sys), Math.hypot(sn, sys));
  return { ok: true, frames: T.pts.length, span, pmra, pmdec, pmraErr: Math.hypot(se, sys), pmdecErr: Math.hypot(sn, sys), total,
    totalErr: totalErrFull, statErr: proj(se, sn), sysErr: sys,
    refStars: field.n, fieldSys: field.sys,
    // significance rule (shared by the viewer and the Proof page): a motion counts only when it
    // is at least 3 × its full uncertainty (statistical + floor) AND at least MIN_MOTION_MASYR.
    // Otherwise it is reported as "no significant motion (< upperLimit)", upperLimit = the larger
    // of value + 2 × uncertainty (~98% bound) and MIN_MOTION_MASYR.
    significant: total >= 3 * totalErrFull && total >= MIN_MOTION_MASYR,
    floor: Math.max(3 * totalErrFull, MIN_MOTION_MASYR), upperLimit: Math.max(total + 2 * totalErrFull, MIN_MOTION_MASYR),
    seeded, rejected: acc.length - T.pts.length,
    points: T.pts.map(p => ({ mjd: p.mjd, x: p.x, y: p.y, e: p.e, n: p.n, w: p.w })),
    fit: { ae: fe.a, be: fe.b, an: fn.a, bn: fn.b } };
}

// Systematic floor (mas/yr per axis). Estimated once from every field star that fieldFloor()
// finds in the five proof targets' fields (tools/make_proof.mjs data, 14 Nov 2026: 120 images
// each, 2.5′ field, all detectors): 5 stars = 10 fitted motions that should all be 0 give
// χ² = 27.0 for 10 with their own error bars alone; Σ μ²/(σ² + s²) = 10 at s = 151 mas/yr.
// One field rarely holds enough stars to measure its own floor, so this pooled value is the
// minimum; a field with 3 or more usable field stars can raise it (never lower it).
// See the method notes on web/proof.html.
export const SYS_FLOOR_MASYR = 150;

// Smallest motion we claim (mas/yr). The non-moving control, RW Aurigae (catalogue 0.02″/yr),
// comes out at 0.51-0.60″/yr depending on which flagged images are hidden (0.57-0.65 with the
// earlier, unweighted fit; make_proof.mjs 14 Nov 2026), rounded up to 0.7: a drift of its own
// light centre (east-west, aperture-independent, not seen in the field stars of the same images),
// i.e. an effect of a bright star the field-star floor does not cover. So a motion under 0.7″/yr
// is reported as "no significant motion" even when it is over 3σ.
export const MIN_MOTION_MASYR = 700;

// One measured position: grid (x, y), sky offsets (arcsec east/north of the grid centre)
// with annual parallax taken out, and the image's kind for weighting: detector + whether any
// pixel within 2 px of the centre is blanked (saturated/masked core -> a much noisier centre).
function trackPoint(f, grid, c, t, plx) {
  const [ra, dec] = gridToWorld(grid, c.x, c.y);
  const [xi, eta] = tanProject(ra, dec, grid.ra0, grid.dec0);
  let masked = false;
  for (let j = Math.floor(c.y - 2); j <= Math.ceil(c.y + 2) && !masked; j++) for (let i = Math.floor(c.x - 2); i <= Math.ceil(c.x + 2); i++) {
    if (i >= 0 && j >= 0 && i < f.n && j < f.n && Math.hypot(i - c.x, j - c.y) <= 2 && !Number.isFinite(f.data[j * f.n + i])) { masked = true; break; }
  }
  return { t, mjd: f.mjd, x: c.x, y: c.y, e: xi * 3600 - (plx?.[0] ?? 0), n: eta * 3600 - (plx?.[1] ?? 0), kind: `${f.detector ?? ''}${masked ? 'm' : 'c'}`, masked };
}

// Weighted least-squares line y = a + b t (weights 1/σ²). sigmaB is scaled by the reduced
// chi-square when the points scatter more than their weights say (never scaled down).
function fitLineW(ts, ys, ws) {
  const W = ws.reduce((a, w) => a + w, 0);
  const mt = ts.reduce((a, t, k) => a + ws[k] * t, 0) / W, my = ys.reduce((a, y, k) => a + ws[k] * y, 0) / W;
  let stt = 0, sty = 0;
  for (let k = 0; k < ts.length; k++) { stt += ws[k] * (ts[k] - mt) ** 2; sty += ws[k] * (ts[k] - mt) * (ys[k] - my); }
  const b = sty / stt, a = my - b * mt;
  let chi = 0;
  for (let k = 0; k < ts.length; k++) chi += ws[k] * (ys[k] - a - b * ts[k]) ** 2;
  const red = chi / Math.max(1, ts.length - 2);
  return { a, b, sigmaB: Math.sqrt(Math.max(1, red) / stt), red };
}

// Position noise (arcsec, per axis) of each point's kind of image: the RMS of that kind's
// residuals about the line (east and north pooled). Images of one detector share a PSF size and
// brightness; a blanked (saturated) core leaves only the wings, whose centre is several times
// noisier. Kinds with fewer than 6 images borrow the RMS of all images with the same core
// state, then of all images. 0.1″ minimum.
const SIGMA_MIN = 0.1;
function kindSigmas(pts, fe, fn) {
  const res = pts.map(p => [p.e - fe.a - fe.b * p.t, p.n - fn.a - fn.b * p.t]);
  const rms = (sel) => {
    let ss = 0, m = 0;
    pts.forEach((p, k) => { if (sel(p)) { ss += res[k][0] ** 2 + res[k][1] ** 2; m += 2; } });
    return m ? Math.max(SIGMA_MIN, Math.sqrt(ss / m)) : null;
  };
  const memo = new Map();
  const count = (sel) => pts.filter(sel).length;
  return pts.map(p => {
    if (!memo.has(p.kind)) {
      const byKind = q => q.kind === p.kind, byCore = q => q.masked === p.masked;
      memo.set(p.kind, count(byKind) >= 6 ? rms(byKind) : count(byCore) >= 6 ? rms(byCore) : rms(() => true));
    }
    return memo.get(p.kind);
  });
}

// Fit east and north against time: unweighted first pass; points more than 3 × the overall
// scatter from the line are dropped once (gross misfits only: cosmic rays, a wrong source);
// then noise per kind of image -> weighted fit -> noise re-estimated about that line -> final
// weighted fit.
function fitTrack(acc, minFrames) {
  const fit = (pts, ws) => {
    const ts = pts.map(p => p.t);
    return { fe: fitLineW(ts, pts.map(p => p.e), ws), fn: fitLineW(ts, pts.map(p => p.n), ws) };
  };
  let pts = acc;
  let F = fit(pts, pts.map(() => 1));
  const scatter = (F0) => {
    const r = pts.map(p => (p.e - F0.fe.a - F0.fe.b * p.t) ** 2 + (p.n - F0.fn.a - F0.fn.b * p.t) ** 2);
    return Math.max(Math.sqrt(r.reduce((a, v) => a + v, 0) / Math.max(1, pts.length - 2)), 0.05);
  };
  const lim = 3 * scatter(F);
  const kept = pts.filter(p => Math.hypot(p.e - F.fe.a - F.fe.b * p.t, p.n - F.fn.a - F.fn.b * p.t) <= lim);
  if (kept.length >= minFrames && kept.length < pts.length) { pts = kept; F = fit(pts, pts.map(() => 1)); }
  let sig = kindSigmas(pts, F.fe, F.fn);
  F = fit(pts, sig.map(s => 1 / s ** 2));
  sig = kindSigmas(pts, F.fe, F.fn);
  F = fit(pts, sig.map(s => 1 / s ** 2));
  return { ...F, pts: pts.map((p, k) => ({ ...p, w: 1 / sig[k] ** 2 })) };
}

// Systematic floor from field stars: sources in the median stack of all the images, away
// from the target's track, are measured like the target (same centroid code, weighting and fit,
// a 1.5 px gate around their fixed position; assumed not to move: field stars' own motions are ~0.01″/yr). Each gives
// two fitted motions μ (east, north) with errors σ that should scatter around 0; the floor s
// solves Σ μ²/(σ² + s²) = number of motions (0 if they already scatter no more than σ says).
// Returns { n: field stars used, sys: s in mas/yr per axis or null if none, motions: [μ, σ] pairs }.
export function fieldFloor(fs, grid, track, { radius, minSnr, minFrames, maxStars = 8 }) {
  const st = stackFrames(fs), n = st.n;
  const vals = Array.from(st.data).filter(Number.isFinite).sort((a, b) => a - b);
  if (vals.length < 20) return { n: 0, sys: null, motions: [] };
  const med = vals[vals.length >> 1];
  const mad = 1.4826 * vals.map(v => Math.abs(v - med)).sort((a, b) => a - b)[vals.length >> 1];
  // field stars are fainter: a 2.5 px aperture (all of it inside the grid) keeps their noise down
  const r = Math.min(radius, 2.5), edge = Math.floor(r), clear = radius + r + 1;
  const peaks = [];
  for (let j = edge; j < n - edge; j++) for (let i = edge; i < n - edge; i++) {
    const v = st.data[j * n + i];
    if (!(v > med + 8 * mad)) continue;
    let top = true;
    for (let dj = -1; dj <= 1 && top; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && !(st.data[(j + dj) * n + i + di] < v)) { top = false; break; }
    if (top && track.every(p => Math.hypot(i - p.x, j - p.y) > clear)) peaks.push({ i, j, v });
  }
  peaks.sort((a, b) => b.v - a.v);
  const mus = [];
  for (const p of peaks.slice(0, maxStars)) {
    const pts = [];
    for (const f of fs) {
      const c = centroid(f, p.i, p.j, r);
      if (!c || !(c.snr > minSnr) || Math.hypot(c.x - p.i, c.y - p.j) > 1.5) continue;
      pts.push(trackPoint(f, grid, c, mjdToEpochYear(f.mjd), null));
    }
    if (pts.length < Math.max(minFrames, 10)) continue;
    const ts = pts.map(q => q.t);
    if (Math.max(...ts) - Math.min(...ts) < 0.3) continue;
    const T = fitTrack(pts, minFrames);
    mus.push([T.fe.b * 1000, T.fe.sigmaB * 1000], [T.fn.b * 1000, T.fn.sigmaB * 1000]);
  }
  if (!mus.length) return { n: 0, sys: null, motions: [] };
  const chi = (s) => mus.reduce((a, [m, e]) => a + m * m / (e * e + s * s), 0);
  let sys = 0;
  if (chi(0) > mus.length) {
    let lo = 0, hi = 1e5;
    for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; if (chi(mid) > mus.length) lo = mid; else hi = mid; }
    sys = (lo + hi) / 2;
  }
  return { n: mus.length / 2, sys, motions: mus };
}

// One wording for a measured motion, used by the viewer and the Proof page (arcsec/yr):
// "10.32 ± 0.27″/yr" when significant, else "no significant motion (< 0.86″/yr)".
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
export function motionSummary(m) {
  if (!m?.ok) return null;
  return m.significant
    ? { significant: true, text: `${(m.total / 1000).toFixed(2)} ± ${(m.totalErr / 1000).toFixed(2)}″/yr` }
    : { significant: false, text: `no significant motion (< ${(m.upperLimit / 1000).toFixed(2)}″/yr)` };
}

// Tangential velocity (km/s) = 4.74 × μ (arcsec/yr) × distance (pc) = 4.74 × μ / parallax (arcsec).
export function tangentialVelocity(totalMasYr, plxMas) {
  if (!(plxMas > 0) || !Number.isFinite(totalMasYr)) return null;
  return 4.74047 * (totalMasYr / 1000) / (plxMas / 1000);
}
