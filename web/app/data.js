// Data pipeline for the viewer: name -> position -> SPHEREx image list -> aligned frames.
// No DOM here, so the same code runs in the browser and in Node (tools/prebake.mjs),
// which means pre-baked targets hit exactly the same cached URLs as the app.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { listImages, fetchCutout, maskBadPixels, mapLimit } from '../core/irsa.js';
import { resolveName } from '../core/resolve.js';
import { propagate, mjdToDate } from '../core/motion.js';
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

export async function resolveTarget(query, { fetchFn = fetch, signal } = {}) {
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
export async function planImages(target, settings, { base, fetchFn = fetch, signal } = {}) {
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
export async function loadFrame(im, target, grid, settings, { base, fetchFn = fetch, signal, tables, onRetry } = {}) {
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
  return {
    kind: 'frame', n: f.n, data: f.data, mjd: c.mjd, date: c.date, detector: c.detector, obsid: c.obsid,
    wavelengthUm: wl?.wavelength ?? null, bandwidthUm: wl?.bandwidth ?? null, maskedPixels: c.maskedPixels ?? 0,
    expected: moving ? worldToGrid(grid, pos.ra, pos.dec) : null, uri: im.uri, version: c.version,
  };
}

// Whole pipeline with events: RESOLVED, PLANNED, FRAME, FRAME_FAILED, RETRY_WAIT, DONE, ERROR, NOT_FOUND.
export async function run(query, settings, { base, fetchFn = fetch, signal, tables, emit, concurrency = 10 }) {
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

// Measure the target's motion from the frames themselves: centroid near the predicted spot
// in every frame with a clear detection (peak > 5 sigma), turn pixel positions into sky
// offsets, and fit a straight line against time. Returns null when there's too little signal.
export function measureMotion(frames, grid, { radius = 3.5, minSnr = 5, minFrames = 6 } = {}) {
  const pts = [];
  for (const f of frames) {
    const start = f.expected || [grid.c, grid.c];
    const c = centroid(f, start[0], start[1], radius);
    if (!c || !(c.snr > minSnr) || Math.hypot(c.x - start[0], c.y - start[1]) > 2) continue;
    const [ra, dec] = gridToWorld(grid, c.x, c.y);
    const [xi, eta] = tanProject(ra, dec, grid.ra0, grid.dec0);
    pts.push({ t: mjdToEpochYear(f.mjd), e: xi * 3600, n: eta * 3600 });
  }
  if (pts.length < minFrames) return { frames: pts.length, ok: false };
  const ts = pts.map(p => p.t);
  const span = Math.max(...ts) - Math.min(...ts);
  if (span < 0.3) return { frames: pts.length, ok: false, span };
  const fe = fitLine(ts, pts.map(p => p.e)), fn = fitLine(ts, pts.map(p => p.n));
  const pmra = fe.b * 1000, pmdec = fn.b * 1000, se = fe.sigmaB * 1000, sn = fn.sigmaB * 1000;
  const total = Math.hypot(pmra, pmdec);
  const err = total > 0 ? Math.hypot(pmra * se, pmdec * sn) / total : Math.hypot(se, sn);
  return { ok: true, frames: pts.length, span, pmra, pmdec, pmraErr: se, pmdecErr: sn, total, totalErr: err };
}

// Tangential velocity (km/s) = 4.74 × μ (arcsec/yr) × distance (pc) = 4.74 × μ / parallax (arcsec).
export function tangentialVelocity(totalMasYr, plxMas) {
  if (!(plxMas > 0) || !Number.isFinite(totalMasYr)) return null;
  return 4.74047 * (totalMasYr / 1000) / (plxMas / 1000);
}
