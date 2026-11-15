// "Make a light curve" (web/app/lightcurve/make.js, judges' suggestion B).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../web/app/data.js';
import { configurePrebaked } from '../web/core/prebaked.js';
import { fieldGaia } from '../web/app/gaia-overlay.js';
import { makeCurve, bandSet, toCSV, CSV_COLUMNS, lombScargle, periodSearch, periodRange, periodText, falseAlarm, encodeChoices, decodeChoices,
  comparisonCandidates, autoPick, countsText, PERIOD_CAVEAT } from '../web/app/lightcurve/make.js';

const ORIGIN = 'https://star-shift.example';
const proof = JSON.parse(readFileSync(new URL('../web/data/proof.json', import.meta.url), 'utf8'));
const tables = JSON.parse(readFileSync(new URL('../web/core/data/spectral_wcs.json', import.meta.url), 'utf8'));

// The viewer's own loading path on the saved copy (web/prebaked): no network.
async function load(name, key) {
  const fetchImpl = async (url) => new Response(readFileSync(new URL('../web/prebaked/' + String(url).replace(ORIGIN + '/prebaked/', ''), import.meta.url)));
  configurePrebaked({ manifestUrl: ORIGIN + '/prebaked/manifest.json', fileBase: ORIGIN + '/prebaked/', origin: ORIGIN, fetchImpl });
  const real = globalThis.fetch; globalThis.fetch = async (u) => { throw new Error('went live: ' + u); };
  try {
    const frames = []; let grid;
    await run({ type: 'name', name }, { fov: 2.5, max: 120, band: 'all' }, { base: ORIGIN, tables, concurrency: 8,
      emit: e => { if (e.type === 'FRAME') frames.push(e.frame); if (e.type === 'PLANNED') grid = e.plan.grid; } });
    frames.sort((a, b) => a.mjd - b.mjd);
    const stars = await fieldGaia({ grid, preset: key, base: ORIGIN });
    return { frames, grid, stars };
  } finally { globalThis.fetch = real; configurePrebaked(null); }
}
const r3 = (v) => +v.toFixed(3);

test('RW Aurigae offline: with the Proof page\'s choices the numbers are the Proof page\'s', async () => {
  const { frames, grid } = await load('RW Aurigae', 'rw-aur');
  assert.equal(frames.length, 120);
  const c = makeCurve(frames, grid, { bands: bandSet('proof'), aperture: 2.5, comps: [], skipFlagged: false });
  const P = proof.targets.find(t => t.key === 'rw-aur').tests.find(t => t.type === 'brightness');
  assert.equal(c.status, 'ok');
  c.bands.forEach((b, k) => {
    const g = P.measured.groups[k];
    assert.equal(b.long, g.name);
    assert.equal(b.points.length, g.frames);
    assert.deepEqual(b.bySeason.map(s => [s.season, s.n, r3(s.dm), r3(s.sem)]), g.seasons.map(s => [s.season, s.n, s.dm, s.sem]));
    // Proof rounds the season means first, then subtracts (make_proof.mjs)
    const sa = b.bySeason[0], sz = b.bySeason.at(-1);
    assert.equal(r3(r3(sz.dm) - r3(sa.dm)), g.value); assert.equal(r3(Math.hypot(r3(sa.sem), r3(sz.sem))), g.err);
    // every plotted image, one by one (Proof's chart points)
    const cp = P.chart.groups[k].points;
    assert.deepEqual(b.points.map(p => [r3(p.mjd), p.det, r3(p.dm)]), cp.map(p => [p.mjd, p.det, p.dm]));
  });
  assert.equal(c.counts.plotted, P.measured.frames);
  assert.match(countsText(c), /^64 of 120 images plotted · 16 saturated \(a masked pixel within 15″\)/);
  // the default choices: comparison stars from the saved Gaia list, flagged images skipped; the 3.8–5.0 µm change stays
  const { stars } = await load('RW Aurigae', 'rw-aur');
  const cands = comparisonCandidates(stars, frames, grid);
  const comps = autoPick(cands);
  assert.ok(comps.length >= 1 && comps.length <= 3, `auto-picked ${comps.length}`);
  for (const s of comps) assert.ok(s.clean >= frames.length / 2 && s.sepArcsec > 6.5 * 6.15 - 1e-9);
  const d = makeCurve(frames, grid, { comps });
  const long = d.bands.find(b => b.id === 'long');
  assert.ok(long.ok && long.dmag > 0.5, `3.8–5.0 µm change ${long.dmag}`);
  assert.ok(d.bands.some(b => b.points.some(p => p.nComp > 0)), 'at least one band is differential');
});

test('R Draconis offline: saturated, not measurable', async () => {
  const { frames, grid } = await load('R Draconis', 'r-dra');
  const c = makeCurve(frames, grid, {});
  assert.equal(c.status, 'saturated');
  assert.equal(c.counts.plotted, 0);
  assert.equal(c.counts.saturated, frames.length);
});

// ---- synthetic frames: a target and a comparison star on a flat background ----
const N = 25, grid = { n: N, c: 12, scale: 6.15, ra0: 10, dec0: 0 };
function frame({ mjd, det = 2, wl = 1.3, stars }) {
  const data = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let v = 5 + 0.05 * Math.sin(i * 7.3 + j * 3.1 + mjd); // a little background structure, so the noise is not zero
    for (const s of stars) v += s.f * Math.exp(-((i - s.x) ** 2 + (j - s.y) ** 2) / 2) / (2 * Math.PI);
    data[j * N + i] = v;
  }
  return { n: N, data, mjd, detector: det, wavelengthUm: wl, expected: [12, 12] };
}
const COMP = { id: 'Gaia DR3 1', ra: 10 + (12 - 4) * 6.15 / 3600, dec: 0, g: 12 }; // grid x = 4, y = 12 (east is left)
function synth(drift, change) {
  const out = [];
  [60900, 61080, 61270].forEach((t, s) => { for (let k = 0; k < 6; k++) {
    const g = drift(s); // a calibration drift common to every star in the image
    out.push(frame({ mjd: t + k * 2, wl: 1.3 + (k % 2) * 0.01, stars: [{ x: 12, y: 12, f: 1000 * g * change(s) }, { x: 4, y: 12, f: 800 * g }] }));
  } });
  return out;
}

test('comparison stars take out a change every star shares; with none, it stays', () => {
  const fs = synth(s => (s === 2 ? 0.8 : 1), () => 1); // the image scale drops 20% in season 3; the target itself is steady
  const direct = makeCurve(fs, grid, { bands: bandSet('dets'), skipFlagged: false });
  const d2 = direct.bands.find(b => b.id === 'd2');
  assert.ok(Math.abs(d2.dmag - 2.5 * Math.log10(1 / 0.8)) < 0.01, `direct ${d2.dmag}`);
  const diff = makeCurve(fs, grid, { bands: bandSet('dets'), comps: [COMP], skipFlagged: false });
  const e2 = diff.bands.find(b => b.id === 'd2');
  assert.ok(Math.abs(e2.dmag) < 0.005, `differential ${e2.dmag}`);
  assert.ok(e2.points.every(p => p.nComp === 1 && p.err > 0));
  // and a real change of the target survives the comparison
  const real = makeCurve(synth(s => (s === 2 ? 0.8 : 1), s => (s === 2 ? 0.5 : 1)), grid, { bands: bandSet('dets'), comps: [COMP], skipFlagged: false });
  assert.ok(Math.abs(real.bands.find(b => b.id === 'd2').dmag - 2.5 * Math.log10(2)) < 0.01);
});

test('CSV: the columns, one row per image per band, plotted rows carry numbers and the rest say why', () => {
  const fs = synth(() => 1, () => 1);
  fs[0] = { ...fs[0], data: Float32Array.from(fs[0].data) }; fs[0].data[12 * N + 12] = NaN; // a masked centre
  const c = makeCurve(fs, grid, { bands: bandSet('proof'), skipFlagged: false });
  const lines = toCSV(c, 'Test star').trim().split('\n');
  assert.deepEqual(lines[0].split(','), CSV_COLUMNS);
  assert.deepEqual(CSV_COLUMNS, ['source', 'band', 'date_utc', 'mjd', 'detector', 'wavelength_um', 'flux_mJy', 'flux_err_mJy', 'dmag', 'dmag_err', 'n_comparison', 'season', 'status']);
  assert.equal(lines.length - 1, fs.length); // detector 2 only: in one band
  const rows = lines.slice(1).map(l => Object.fromEntries(l.split(',').map((v, k) => [CSV_COLUMNS[k], v])));
  const plotted = rows.filter(r => r.status === 'plotted');
  assert.equal(plotted.length, c.counts.plotted);
  for (const r of plotted) { assert.ok(Number.isFinite(+r.dmag) && r.dmag !== ''); assert.ok(+r.flux_mJy > 0); assert.match(r.date_utc, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/); }
  assert.equal(rows.find(r => r.status === 'saturated')?.mjd, fs[0].mjd.toFixed(5));
  assert.equal(rows[0].band, '0.75–3.8 µm');
});

test('Lomb–Scargle finds a sinusoid\'s period when the sampling allows, and claims nothing when it does not', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const P = 7.3, t = Array.from({ length: 160 }, () => 61000 + rnd() * 200).sort((a, b) => a - b);
  const pts = t.map(m => ({ mjd: m, dm: 0.3 * Math.sin(2 * Math.PI * m / P) + 0.03 * (rnd() - 0.5), err: 0.02 }));
  const ps = periodSearch(pts);
  assert.ok(ps.range.ok && ps.range.pMin < P && ps.range.pMax > P);
  assert.ok(ps.claim, periodText(ps));
  assert.ok(Math.abs(ps.claim.period - P) / P < 0.01, `found ${ps.claim.period}`);
  assert.ok(ps.claim.fap < 1e-6);
  assert.match(periodText(ps), /^Period 7\.3 days/);
  // direct check of the power at the true frequency against a far one
  const [pTrue, pFar] = lombScargle(t, pts.map(p => p.dm), pts.map(p => p.err), [1 / P, 1 / 3.1]);
  assert.ok(pTrue > 0.9 && pFar < 0.1);
  // SPHEREx-like sampling: three ~2-week visits six months apart. Even a clean sinusoid is never claimed.
  const sx = [];
  [60920, 61100, 61290].forEach(t0 => { for (let k = 0; k < 14; k++) sx.push(t0 + k * 1.3); });
  const sp = periodSearch(sx.map(m => ({ mjd: m, dm: 0.3 * Math.sin(2 * Math.PI * m / 250), err: 0.02 })));
  assert.equal(sp.claim, null);
  assert.equal(sp.why, 'sampling');
  assert.equal(periodRange(sx).visits, 3);
  assert.match(periodText(sp), /^No period can be claimed/);
  // pure noise in a well-sampled run: no claim either
  const nz = periodSearch(t.map(m => ({ mjd: m, dm: 0.05 * (rnd() - 0.5), err: 0.02 })));
  assert.equal(nz.claim, null);
  assert.ok(falseAlarm(0.05, 100, 50) > 0.5 && falseAlarm(0.5, 100, 50) < 1e-9);
  assert.equal(PERIOD_CAVEAT, "SPHEREx visits a spot roughly every 6 months, so periods shorter than ~1 year can't be found; this shows what the data can and can't say.");
});

test('choices survive the link', () => {
  const s = encodeChoices({ bandKind: 'dets', aperture: 3, skipFlagged: false, comps: [{ id: 'Gaia DR3 156430856476049024' }], source: { ra: 76.95, dec: 30.4 }, period: true });
  assert.deepEqual(decodeChoices(s), { bandKind: 'dets', aperture: 3, skipFlagged: false, comps: ['Gaia DR3 156430856476049024'], source: { ra: 76.95, dec: 30.4 }, period: true });
  assert.deepEqual(decodeChoices(encodeChoices({ comps: [] })).comps, []);
  const junk = decodeChoices('b=<x>;a=99;c=1.<script>;s=1,200');
  assert.equal(junk.bandKind, 'proof'); assert.equal(junk.aperture, 2.5); assert.deepEqual(junk.comps, ['Gaia DR3 1']); assert.equal(junk.source, null);
});
