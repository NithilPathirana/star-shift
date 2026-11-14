// Prove the data core on NASA's five test targets with live IRSA data.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// For each target: look it up in SIMBAD, list every SPHEREx image covering it, download
// cutouts (trimmed), put them on one sky grid, and save frames + metadata to evidence/.
// For Barnard's Star it also measures the star's motion and compares it with the catalogue.
//
// Usage: node tools/prove_targets.mjs [maxFramesPerTarget=all]

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolveName } from '../web/core/resolve.js';
import { listImages, fetchCutout, decodeCutout, mapLimit, cutoutUrl } from '../web/core/irsa.js';
import { propagate, separationArcsec, parseAngle, mjdToDate, mjdToEpochYear, epochYearToMjd } from '../web/core/motion.js';
import { makeGrid, reproject, centroid, worldToGrid, fitLine } from '../web/core/align.js';
import { wavelengthAt } from '../web/core/wave.js';
import { tanProject } from '../web/core/wcs.js';
import { createHash } from 'node:crypto';

const MAX = Number(process.argv[2]) || Infinity;
const SIZE_DEG = 0.05;           // cutout size requested from IRSA (180")
const GRID_ARCSEC = 150;         // aligned frame size (25 px)
const ROOT = new URL('../evidence/', import.meta.url);
const CACHE = new URL('./cache/', ROOT);
mkdirSync(CACHE, { recursive: true });
const tables = JSON.parse(readFileSync(new URL('../web/core/data/spectral_wcs.json', import.meta.url), 'utf8'));

const TARGETS = [
  { key: 'barnard', label: "Barnard's Star", simbad: "Barnard's star" },
  { key: 'eps-indi-b', label: 'Epsilon Indi B', simbad: 'eps Ind B' },
  { key: 'wise-0855', label: 'WISE 0855', simbad: 'WISE J085510.83-071442.5',
    nasa: { ra: parseAngle('08h55m10.831s', true), dec: parseAngle('-7d14m42.53s', false) } },
  { key: 'rw-aur', label: 'RW Aurigae', simbad: 'RW Aur' },
  { key: 'r-dra', label: 'R Draconis', simbad: 'R Dra' },
];

// Cached download of the trimmed cutout bytes (so re-runs don't hit IRSA again).
async function cachedCutout(uri, ra, dec) {
  const key = createHash('sha1').update(cutoutUrl(uri, ra, dec, SIZE_DEG)).digest('hex');
  const f = new URL(key + '.fits', CACHE);
  if (existsSync(f)) return decodeCutout(new Uint8Array(readFileSync(f)));
  let raw;
  const keep = (b) => { raw = b; return new Response(b); };
  const c = await fetchCutout(uri, ra, dec, SIZE_DEG, {
    fetchFn: async (u, o) => {
      const res = await fetch(u, o);
      if (!res.ok) return res;
      const { readHDUsFromStream } = await import('../web/core/fits.js');
      return keep(await readHDUsFromStream(res.body, 3));
    },
  });
  writeFileSync(f, raw);
  return c;
}

function visits(mjds, gapDays = 5) {
  const groups = [];
  for (const m of mjds) {
    const g = groups[groups.length - 1];
    if (g && m - g.end < gapDays) { g.end = m; g.n++; } else groups.push({ start: m, end: m, n: 1 });
  }
  return groups.map(g => ({ from: mjdToDate(g.start).toISOString().slice(0, 10), to: mjdToDate(g.end).toISOString().slice(0, 10), images: g.n }));
}

function pick(arr, n) {
  if (arr.length <= n) return arr;
  return Array.from({ length: n }, (_, k) => arr[Math.round((k * (arr.length - 1)) / (n - 1))]);
}

const summary = { generated: new Date().toISOString(), cutoutSizeDeg: SIZE_DEG, gridArcsec: GRID_ARCSEC, targets: [] };

for (const t of TARGETS) {
  const t0 = Date.now();
  const star = await resolveName(t.simbad);
  if (!star) throw new Error('SIMBAD found nothing for ' + t.simbad);
  const mid = propagate(star, epochYearToMjd(2026.0));
  const images = await listImages(mid.ra, mid.dec);
  const perDet = {};
  for (const im of images) perDet['D' + im.detector] = (perDet['D' + im.detector] || 0) + 1;
  const chosen = pick(images, MAX);

  let failed = 0;
  const frames = [];
  const grid = makeGrid(mid.ra, mid.dec, GRID_ARCSEC);
  let doneN = 0;
  const results = await mapLimit(chosen, 6, async (im) => {
    const pos = propagate(star, im.mjdStart); // centre each cutout on where the star is that day
    return cachedCutout(im.uri, pos.ra, pos.dec);
  }, () => { if (++doneN % 10 === 0) console.log(`  ${t.label}: ${doneN}/${chosen.length}`); });
  results.forEach((r, k) => {
    if (!r.ok) { failed++; return; }
    const c = r.value;
    const pos = propagate(star, c.mjd);
    const [px, py] = c.wcs.worldToPix(pos.ra, pos.dec);
    const tab = tables[String(c.detector)];
    const wl = tab ? wavelengthAt(c.header, tab, px, py).wavelength : null;
    const f = reproject(c, grid);
    const [ex, ey] = worldToGrid(grid, pos.ra, pos.dec);
    frames.push({ mjd: c.mjd, date: c.date, detector: c.detector, obsid: c.obsid, wavelengthUm: wl,
      expected: [ex, ey], frame: f, uri: chosen[k].uri });
  });
  frames.sort((a, b) => a.mjd - b.mjd);

  const entry = {
    key: t.key, label: t.label, simbad: star,
    positionJ2026: mid,
    imagesFound: images.length, imagesPerDetector: perDet,
    firstDate: images.length ? mjdToDate(images[0].mjdStart).toISOString().slice(0, 10) : null,
    lastDate: images.length ? mjdToDate(images[images.length - 1].mjdStart).toISOString().slice(0, 10) : null,
    visits: visits(images.map(i => i.mjdStart)),
    framesFetched: frames.length, framesFailed: failed, seconds: Math.round((Date.now() - t0) / 1000),
  };
  if (t.nasa) {
    const p0 = propagate(star, images[0]?.mjdStart ?? epochYearToMjd(2026));
    entry.nasaPositionOffsetArcsec = separationArcsec(t.nasa.ra, t.nasa.dec, p0.ra, p0.dec);
    entry.nasaPositionOffsetPixels = entry.nasaPositionOffsetArcsec / 6.15;
  }

  // Motion measurement: centroid near the grid centre (not at the expected spot, to avoid bias).
  if (Math.hypot(star.pmra, star.pmdec) > 1000) {
    const meas = [];
    for (const fr of frames) {
      const c = centroid(fr.frame, grid.c, grid.c, 2.5);
      if (!c || !(c.peak > 0)) continue;
      const signal = c.peak / Math.max(1e-9, Math.abs(c.bg) || 1);
      meas.push({ t: mjdToEpochYear(fr.mjd), x: c.x, y: c.y, ex: fr.expected[0], ey: fr.expected[1], peak: c.peak, signal });
    }
    // Keep detections that land within 2 px of the predicted track (others are blends/noise).
    const good = meas.filter(m => Math.hypot(m.x - m.ex, m.y - m.ey) < 2);
    if (good.length >= 4) {
      const ts = good.map(m => m.t);
      // grid x grows to the west, y grows to the south -> convert to arcsec east / north
      const east = good.map(m => (grid.c - m.x) * grid.scale), north = good.map(m => (grid.c - m.y) * grid.scale);
      const fe = fitLine(ts, east), fn = fitLine(ts, north);
      const resid = good.map(m => Math.hypot(m.x - m.ex, m.y - m.ey) * grid.scale);
      const first = good[0], last = good[good.length - 1];
      entry.motion = {
        framesUsed: good.length, framesTried: meas.length,
        catalogue_mas_per_yr: { pmra: star.pmra, pmdec: star.pmdec, total: Math.hypot(star.pmra, star.pmdec) },
        measured_mas_per_yr: {
          pmra: fe.b * 1000, pmra_err: fe.sigmaB * 1000, pmdec: fn.b * 1000, pmdec_err: fn.sigmaB * 1000,
          total: Math.hypot(fe.b, fn.b) * 1000,
        },
        span: { from: first.t.toFixed(3), to: last.t.toFixed(3), years: +(last.t - first.t).toFixed(3) },
        shift_first_to_last: {
          measured_arcsec: Math.hypot(first.x - last.x, first.y - last.y) * grid.scale,
          expected_arcsec: Math.hypot(first.ex - last.ex, first.ey - last.ey) * grid.scale,
          measured_px: Math.hypot(first.x - last.x, first.y - last.y),
        },
        median_offset_from_prediction_arcsec: resid.sort((a, b) => a - b)[resid.length >> 1],
      };
    } else entry.motion = { note: 'too few clean detections', framesTried: meas.length, good: good.length };
  }
  summary.targets.push(entry);

  // Frames for the PNG/GIF renderer (tools/render_evidence.py).
  writeFileSync(new URL(`frames_${t.key}.json`, ROOT), JSON.stringify({
    label: t.label, grid, frames: frames.map(f => ({ mjd: f.mjd, date: f.date, detector: f.detector,
      wavelengthUm: f.wavelengthUm, expected: f.expected, data: Array.from(f.frame.data, v => (Number.isFinite(v) ? +v.toPrecision(5) : null)) })),
  }));
  console.log(`${t.label}: ${images.length} images (${JSON.stringify(perDet)}), fetched ${frames.length}, failed ${failed}, ${entry.seconds}s`);
  if (entry.motion?.measured_mas_per_yr) console.log('  motion', JSON.stringify(entry.motion.measured_mas_per_yr), 'vs', JSON.stringify(entry.motion.catalogue_mas_per_yr));
}
writeFileSync(new URL('summary.json', ROOT), JSON.stringify(summary, null, 1));
console.log('wrote evidence/summary.json');
