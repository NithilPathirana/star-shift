// Experiment (not used by the viewer or the Proof page): does a still neighbour inside the measuring
// circle bias a measured motion, and does fitting it out help? For each quick-pick target, runs the
// Proof page's motion measurement (same frames, same detectors) twice: as shipped (light centre), and
// with data.js measureMotion's default-off `neighbours` option (two-source PSF fit, each catalogued
// still neighbour held at its Gaia DR3 position; apertureNeighbours picks them by a generic rule).
// Prints value ± error, images used, nσ from the catalogue, the track's residual scatter, and how the
// result moves with the PSF width (± 0.08 px). Writes nothing.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Usage: (server running on 8787) node tools/neighbour_fit_experiment.mjs
// Gaia neighbours come from the pre-baked Gaia field cone (web/prebaked/, offline), else live Gaia.

import { readFileSync } from 'node:fs';
import { run, measureMotion, motionDetectors, apertureNeighbours, PSF_SIGMA_PX } from '../web/app/data.js';
import { PRESETS } from '../web/app/presets.js';
import { DEFAULT_SETTINGS } from '../web/app/query.js';
import { gaiaCone } from '../web/core/resolve.js';
import { parseCSV } from '../web/core/irsa.js';
import { propagate, mjdToEpochYear } from '../web/core/motion.js';
import { motionVerdict } from '../web/app/proof/logic.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const SETTINGS = { ...DEFAULT_SETTINGS, fov: 2.5, max: 120, band: 'all' }; // as tools/make_proof.mjs
const TABLES = JSON.parse(readFileSync(new URL('../web/core/data/spectral_wcs.json', import.meta.url), 'utf8'));
const PROOF = JSON.parse(readFileSync(new URL('../web/data/proof.json', import.meta.url), 'utf8')); // catalogue values (read only)
const MANIFEST = JSON.parse(readFileSync(new URL('../web/prebaked/manifest.json', import.meta.url), 'utf8')).entries;
const as = (v, d = 2) => (v / 1000).toFixed(d);

async function frames(p) {
  const out = []; let grid = null;
  await run({ type: 'name', name: p.label }, SETTINGS, { base: BASE, tables: TABLES, concurrency: 4, emit: (e) => {
    if (e.type === 'PLANNED') grid = e.plan.grid; else if (e.type === 'FRAME') out.push(e.frame);
  } });
  return { frames: out.sort((a, b) => a.mjd - b.mjd), grid };
}

async function gaiaSources(p, grid, fs) {
  const hit = Object.entries(MANIFEST).find(([k, v]) => k.startsWith('/gaia/tap/sync') && v.file?.startsWith(p.key + '/'));
  const rows = (r) => ({ id: 'Gaia DR3 ' + r.source_id, ra: +r.ra, dec: +r.dec, pmra: +r.pmra || 0, pmdec: +r.pmdec || 0, g: +r.phot_g_mean_mag, epoch: 2016 });
  if (hit) return { from: 'pre-baked Gaia DR3 field cone', list: parseCSV(readFileSync(new URL('../web/prebaked/' + hit[1].file, import.meta.url), 'utf8')).map(rows) };
  try {
    const at = propagate(p.target, (fs[0].mjd + fs[fs.length - 1].mjd) / 2);
    return { from: 'live Gaia DR3 cone', list: await gaiaCone(at.ra, at.dec, grid.n * grid.scale / 2) };
  } catch (e) { return { from: `no catalogue (${e.message})`, list: [] }; }
}

// RMS (arcsec, per axis) of the fitted positions about the fitted line
function rms(m) {
  const r = m.points.map(q => { const t = mjdToEpochYear(q.mjd); return [q.e - m.fit.ae - m.fit.be * t, q.n - m.fit.an - m.fit.bn * t]; });
  return Math.sqrt(r.reduce((a, [x, y]) => a + x * x + y * y, 0) / (2 * r.length));
}

for (const p of PRESETS) {
  const { frames: all, grid } = await frames(p);
  const dets = motionDetectors(p);
  const fs = dets ? all.filter(f => dets.includes(f.detector)) : all;
  const t = PROOF.targets.find(q => q.key === p.key)?.tests?.[0];
  const cat = { total: t?.expected?.value ?? Math.hypot(p.target.pmra, p.target.pmdec), err: t?.expected?.err ?? null, pmra: p.target.pmra, pmdec: p.target.pmdec };
  const src = await gaiaSources(p, grid, fs);
  const nbs = apertureNeighbours(p.target, src.list, fs.map(f => f.mjd), grid);
  const line = (label, m) => {
    if (!m.ok) return `  ${label}: no fit (${m.reason || 'too few images'}, ${m.frames} images)`;
    const v = motionVerdict(m, cat.total, cat.err, m.span, cat);
    return `  ${label}: ${as(m.total)} ± ${as(m.totalErr)}″/yr (stat ${as(m.statErr)}), ${m.frames} of ${fs.length} images, `
      + `${v.sigma != null ? `${(m.total < cat.total ? '-' : '+')}${v.sigma.toFixed(1)}σ from catalogue, ${v.verdict}` : v.verdict}, residual RMS ${rms(m).toFixed(2)}″/axis`;
  };
  console.log(`${p.label}: catalogue ${as(cat.total)}″/yr; ${dets ? `detectors ${dets.join('-')}` : 'all detectors'}; ${src.from}: ${src.list.length} sources; `
    + `still neighbours in the circle: ${nbs.length ? nbs.map(s => `${s.id} (G ${s.g?.toFixed?.(2) ?? s.g})`).join(', ') : 'none'}`);
  const m0 = measureMotion(fs, grid);
  console.log(line('as shipped      ', m0));
  if (!nbs.length) { console.log('  neighbour fit   : not applicable (no catalogued still source inside the circle), identical to shipped'); continue; }
  console.log(line('neighbour fit   ', measureMotion(fs, grid, { neighbours: nbs })));
  for (const d of [-0.08, 0.08]) {
    const ps = Object.fromEntries(Object.entries(PSF_SIGMA_PX).map(([k, s]) => [k, s + d]));
    console.log(line(`  PSF σ ${d > 0 ? '+' : '−'}0.08 px`, measureMotion(fs, grid, { neighbours: nbs, psfSigma: ps })));
  }
}
