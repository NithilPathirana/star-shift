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
import { listImages, fetchCutout, decodeCutout, mapLimit, cutoutUrl, maskBadPixels } from '../web/core/irsa.js';
import { propagate, separationArcsec, parseAngle, mjdToDate, mjdToEpochYear, epochYearToMjd } from '../web/core/motion.js';
import { makeGrid, reproject, centroid, worldToGrid, fitLine, stackFrames } from '../web/core/align.js';
import { wavelengthAt } from '../web/core/wave.js';
import { tanProject } from '../web/core/wcs.js';
import { createHash } from 'node:crypto';

const MAX = Number(process.argv[2]) || Infinity;
const SIZE_DEG = 0.05;           // cutout size requested from IRSA (180")
const GRID_ARCSEC = 150;
const RADIUS_DEFAULT = Number(process.env.CENTROID_R) || 3.5; // px (3.5 measured best on Barnard's Star)         // aligned frame size (25 px)
const ROOT = new URL('../evidence/', import.meta.url);
const CACHE = new URL('./cache/', ROOT);
mkdirSync(CACHE, { recursive: true });
const tables = JSON.parse(readFileSync(new URL('../web/core/data/spectral_wcs.json', import.meta.url), 'utf8'));

const TARGETS = [
  { key: 'barnard', label: "Barnard's Star", simbad: "Barnard's star" },
  { key: 'eps-indi-b', label: 'Epsilon Indi B', simbad: 'eps Ind B' },
  // WISE 0855 (~250 K) is only bright at 4-5 um; at short wavelengths a background star 1 px away dominates.
  { key: 'wise-0855', label: 'WISE 0855', simbad: 'WISE J085510.83-071442.5', minWavelengthUm: 3.8, fetchDetectors: [5, 6], radius: 2.5,
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
  const RADIUS = t.radius ?? RADIUS_DEFAULT;
  const pool = t.fetchDetectors ? images.filter(im => t.fetchDetectors.includes(im.detector)) : images;
  const chosen = pick(pool, t.fetchDetectors ? Infinity : MAX);

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
    const c = maskBadPixels(r.value);
    const pos = propagate(star, c.mjd);
    const [px, py] = c.wcs.worldToPix(pos.ra, pos.dec);
    const tab = tables[String(c.detector)];
    const wl = tab ? wavelengthAt(c.header, tab, px, py).wavelength : null;
    const f = reproject(c, grid);
    const [ex, ey] = worldToGrid(grid, pos.ra, pos.dec);
    frames.push({ masked: c.maskedPixels, mjd: c.mjd, date: c.date, detector: c.detector, obsid: c.obsid, wavelengthUm: wl,
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

  // Motion measurement: centroid near the grid centre (not at the expected spot, to avoid
  // bias), keep clear detections (peak > 5 sigma), then average per observing season
  // (SPHEREx sees each spot every ~6 months) and compare season-to-season shifts.
  if (Math.hypot(star.pmra, star.pmdec) > 1000) {
    const meas = [];
    for (const fr of frames) {
      if (t.minWavelengthUm && !(fr.wavelengthUm >= t.minWavelengthUm)) continue;
      const c = centroid(fr.frame, grid.c, grid.c, RADIUS);
      if (!c || !(c.snr > 5)) continue;
      // grid x grows west, y grows south -> arcsec east / north of grid centre
      meas.push({ t: mjdToEpochYear(fr.mjd), mjd: fr.mjd, det: fr.detector, wl: fr.wavelengthUm, snr: c.snr,
        e: (grid.c - c.x) * grid.scale, n: (grid.c - c.y) * grid.scale,
        ee: (grid.c - fr.expected[0]) * grid.scale, en: (grid.c - fr.expected[1]) * grid.scale });
    }
    const seasons = [];
    for (const m of meas) {
      const s0 = seasons[seasons.length - 1];
      if (s0 && m.mjd - s0.last < 60) { s0.items.push(m); s0.last = m.mjd; } else seasons.push({ items: [m], last: m.mjd });
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const sem = (a) => a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - mean(a)) ** 2, 0) / (a.length - 1) / a.length) : NaN;
    const S = seasons.filter(s => s.items.length >= 3).map(s => ({
      from: mjdToDate(s.items[0].mjd).toISOString().slice(0, 10), to: mjdToDate(s.last).toISOString().slice(0, 10),
      frames: s.items.length, t: mean(s.items.map(m => m.t)),
      east: mean(s.items.map(m => m.e)), north: mean(s.items.map(m => m.n)),
      east_err: sem(s.items.map(m => m.e)), north_err: sem(s.items.map(m => m.n)),
      exp_east: mean(s.items.map(m => m.ee)), exp_north: mean(s.items.map(m => m.en)),
    }));
    const r = (v) => Math.round(v * 100) / 100;
    entry.motion = {
      note: 'Positions in arcsec east/north of the frame centre. 1 SPHEREx pixel = 6.15 arcsec.',
      centroidRadiusPx: RADIUS, minWavelengthUm: t.minWavelengthUm ?? null,
      framesWithClearDetection: meas.length, framesTotal: frames.length,
      detectorsUsed: [...new Set(meas.map(m => m.det))].sort(),
      seasons: S.map(s => ({ ...s, t: r(s.t), east: r(s.east), north: r(s.north), east_err: r(s.east_err), north_err: r(s.north_err),
        exp_east: r(s.exp_east), exp_north: r(s.exp_north), offset_from_prediction: r(Math.hypot(s.east - s.exp_east, s.north - s.exp_north)) })),
    };
    if (S.length >= 2) {
      const f = S[0], l = S[S.length - 1];
      const dE = l.east - f.east, dN = l.north - f.north, xE = l.exp_east - f.exp_east, xN = l.exp_north - f.exp_north;
      const err = Math.hypot(f.east_err, l.east_err, f.north_err, l.north_err) / Math.SQRT2;
      entry.motion.firstToLastSeason = {
        years: r(l.t - f.t),
        measured_arcsec: r(Math.hypot(dE, dN)), measured_err_arcsec: r(err), expected_arcsec: r(Math.hypot(xE, xN)),
        measured_px: r(Math.hypot(dE, dN) / 6.15), expected_px: r(Math.hypot(xE, xN) / 6.15),
        direction_measured_deg: r(Math.atan2(dE, dN) * 180 / Math.PI), direction_expected_deg: r(Math.atan2(xE, xN) * 180 / Math.PI),
      };
      const fe = fitLine(meas.map(m => m.t), meas.map(m => m.e)), fn = fitLine(meas.map(m => m.t), meas.map(m => m.n));
      entry.motion.lineFit_mas_per_yr = { pmra: Math.round(fe.b * 1000), pmra_err: Math.round(fe.sigmaB * 1000),
        pmdec: Math.round(fn.b * 1000), pmdec_err: Math.round(fn.sigmaB * 1000), catalogue: [star.pmra, star.pmdec] };
    }
  }
  // Stacked seasons: median of all usable aligned frames in each ~6-month visit, then centroid.
  if (Math.hypot(star.pmra, star.pmdec) > 1000) {
    const use = frames.filter(fr => !t.minWavelengthUm || fr.wavelengthUm >= t.minWavelengthUm);
    const groups = [];
    for (const fr of use) {
      const g = groups[groups.length - 1];
      if (g && fr.mjd - g.last < 60) { g.items.push(fr); g.last = fr.mjd; } else groups.push({ items: [fr], last: fr.mjd });
    }
    const rows = groups.filter(g => g.items.length >= 3).map(g => {
      const st = stackFrames(g.items.map(fr => fr.frame));
      const ex = g.items.reduce((a, fr) => a + fr.expected[0], 0) / g.items.length;
      const ey = g.items.reduce((a, fr) => a + fr.expected[1], 0) / g.items.length;
      const c = centroid(st, grid.c, grid.c, RADIUS);
      return { from: mjdToDate(g.items[0].mjd).toISOString().slice(0, 10), to: mjdToDate(g.last).toISOString().slice(0, 10),
        frames: g.items.length, t: g.items.reduce((a, fr) => a + mjdToEpochYear(fr.mjd), 0) / g.items.length,
        east: c && (grid.c - c.x) * grid.scale, north: c && (grid.c - c.y) * grid.scale, snr: c && c.snr,
        exp_east: (grid.c - ex) * grid.scale, exp_north: (grid.c - ey) * grid.scale, stack: st };
    }).filter(r => r.snr > 5);
    const r2 = (v) => Math.round(v * 100) / 100;
    entry.stackedSeasons = rows.map(({ stack, ...r }) => ({ ...r, t: r2(r.t), east: r2(r.east), north: r2(r.north), snr: r2(r.snr),
      exp_east: r2(r.exp_east), exp_north: r2(r.exp_north), offset_from_prediction_arcsec: r2(Math.hypot(r.east - r.exp_east, r.north - r.exp_north)) }));
    if (rows.length >= 2) {
      const f = rows[0], l = rows[rows.length - 1];
      const dE = l.east - f.east, dN = l.north - f.north, xE = l.exp_east - f.exp_east, xN = l.exp_north - f.exp_north;
      entry.stackedFirstToLast = { years: r2(l.t - f.t), measured_arcsec: r2(Math.hypot(dE, dN)), expected_arcsec: r2(Math.hypot(xE, xN)),
        measured_px: r2(Math.hypot(dE, dN) / 6.15), expected_px: r2(Math.hypot(xE, xN) / 6.15),
        direction_measured_deg: r2(Math.atan2(dE, dN) * 180 / Math.PI), direction_expected_deg: r2(Math.atan2(xE, xN) * 180 / Math.PI) };
    }
    writeFileSync(new URL(`stacks_${t.key}.json`, ROOT), JSON.stringify({ label: t.label + ' (season stacks)', grid,
      frames: rows.map(r => ({ mjd: 0, date: r.from + ' to ' + r.to, detector: 'stack', wavelengthUm: null,
        expected: [grid.c - r.exp_east / grid.scale, grid.c - r.exp_north / grid.scale],
        data: Array.from(r.stack.data, v => (Number.isFinite(v) ? +v.toPrecision(5) : null)) })) }));
    console.log('  stacked', JSON.stringify(entry.stackedFirstToLast));
  }
  entry.lightCurve = frames.map(fr => {
    const c = centroid(fr.frame, fr.expected[0], fr.expected[1], 2, 1);
    return { date: fr.date.slice(0, 16), detector: fr.detector, wavelengthUm: fr.wavelengthUm && +fr.wavelengthUm.toFixed(3),
      flux: c ? +c.flux.toPrecision(4) : null, snr: c ? +c.snr.toFixed(1) : null, maskedPixels: fr.masked };
  });
  summary.targets.push(entry);

  // Frames for the PNG/GIF renderer (tools/render_evidence.py).
  writeFileSync(new URL(`frames_${t.key}.json`, ROOT), JSON.stringify({
    label: t.label, grid, frames: frames.map(f => ({ mjd: f.mjd, date: f.date, detector: f.detector,
      wavelengthUm: f.wavelengthUm, expected: f.expected, data: Array.from(f.frame.data, v => (Number.isFinite(v) ? +v.toPrecision(5) : null)) })),
  }));
  console.log(`${t.label}: ${images.length} images (${JSON.stringify(perDet)}), fetched ${frames.length}, failed ${failed}, ${entry.seconds}s`);
  if (entry.motion) console.log('  motion', JSON.stringify(entry.motion.firstToLastSeason), JSON.stringify(entry.motion.lineFit_mas_per_yr));
}
writeFileSync(new URL('summary.json', ROOT), JSON.stringify(summary, null, 1));
console.log('wrote evidence/summary.json');
