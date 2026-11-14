// Proper-motion bias checks on synthetic SPHEREx-like images: an undersampled, pixel-integrated
// PSF on a randomly rotated native 6.15″ grid, redrawn on the display grid with align.reproject
// exactly as the app does. Known motion in -> the same motion out, a still star -> about 0,
// parallax removed, saturated-core images down-weighted, systematic floor folded in.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureMotion, motionSummary, SYS_FLOOR_MASYR, MIN_MOTION_MASYR } from '../web/app/data.js';
import { makeGrid, reproject, worldToGrid } from '../web/core/align.js';
import { propagate, epochYearToMjd, parallaxShift, earthBarycentric } from '../web/core/motion.js';
import { tanProject } from '../web/core/wcs.js';

const D = Math.PI / 180;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const mass = (a, b, s) => 0.5 * (erf(b / (Math.SQRT2 * s)) - erf(a / (Math.SQRT2 * s)));
// pixel-integrated PSF: Gaussian core (sigma 0.45 native px: undersampled) + 15% broad wing
const psfPix = (dx, dy, s) => 0.85 * mass(dx - 0.5, dx + 0.5, s) * mass(dy - 0.5, dy + 0.5, s) + 0.15 * mass(dx - 0.5, dx + 0.5, 3 * s) * mass(dy - 0.5, dy + 0.5, 3 * s);

// Frames like the app's: cutout centred on the star (random sub-pixel phase), random roll each
// image, bilinear reprojection onto one north-up grid. `sat`: pixels above it are blanked (NaN)
// in detectors listed in `satDets`. `plx` (mas): the image shows the parallax shift; `tagPlx`
// attaches plxShift as loadFrame does.
function simulate({ pmra = -800, pmdec = 10360, ra = 269.45, dec = 4.69, plx = 0, tagPlx = true, flux = 3000, sat = Infinity, satDets = [], noise = 1,
  seed = 1, nPer = 30, seasons = [2025.62, 2026.27, 2026.67], seasonLen = 0.12 } = {}) {
  const r = rng(seed), gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const star = { ra, dec, pmra, pmdec, epoch: 2026 };
  const mjds = []; for (const s0 of seasons) for (let k = 0; k < nPer; k++) mjds.push(epochYearToMjd(s0 + (k / nPer) * seasonLen));
  const c = propagate(star, (mjds[0] + mjds[mjds.length - 1]) / 2);
  const grid = makeGrid(c.ra, c.dec, 150, 6.15);
  const N = 41, scale = 6.15 / 3600, cp = (N - 1) / 2;
  const frames = mjds.map((mjd, k) => {
    const p = propagate(star, mjd);
    const [pe, pn] = parallaxShift(p.ra, p.dec, plx, mjd);
    const seen = { ra: p.ra + pe / 3600 / Math.cos(p.dec * D), dec: p.dec + pn / 3600 };
    const th = r() * 2 * Math.PI, ca = Math.cos(th), sa = Math.sin(th);
    const cra = seen.ra + (r() - 0.5) * 2 * scale / Math.cos(seen.dec * D), cdec = seen.dec + (r() - 0.5) * 2 * scale;
    const wcs = { worldToPix(a, d) { const [xi, eta] = tanProject(a, d, cra, cdec); const u = -xi / scale, v = eta / scale; return [cp + ca * u - sa * v, cp + sa * u + ca * v]; } };
    const [sx, sy] = wcs.worldToPix(seen.ra, seen.dec);
    const detector = 1 + (k % 6);
    const img = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let v = 5 + flux * psfPix(i - sx, j - sy, 0.45) + noise * gauss();
      if (satDets.includes(detector) && v > sat) v = NaN;
      img[j * N + i] = v;
    }
    const f = reproject({ wcs, image: { nx: N, ny: N, data: img }, flags: null }, grid);
    return { n: f.n, data: f.data, mjd, detector, expected: worldToGrid(grid, p.ra, p.dec), plxShift: tagPlx && plx ? parallaxShift(p.ra, p.dec, plx, mjd) : null };
  });
  return { frames, grid };
}

test('motion bias: undersampled moving PSF, known motion recovered without bias (Barnard-like and Eps Indi B-like)', () => {
  for (const cfg of [{ pmra: -800, pmdec: 10360 }, { pmra: 3982, pmdec: -2467, ra: 331.04, dec: -56.78, flux: 800, seasons: [2025.4, 2025.9, 2026.4, 2026.85] }]) {
    const truth = Math.hypot(cfg.pmra, cfg.pmdec);
    const got = [];
    for (const seed of [1, 2, 3, 4]) {
      const { frames, grid } = simulate({ ...cfg, seed });
      const m = measureMotion(frames, grid);
      assert.ok(m.ok && m.significant, JSON.stringify({ ok: m.ok, reason: m.reason }));
      // each run within 4 statistical sigma (and 1.5%) of the truth
      assert.ok(Math.abs(m.total - truth) < Math.max(4 * m.statErr, 20) && Math.abs(m.total - truth) < 0.015 * truth, `seed ${seed}: ${m.total.toFixed(1)} ± ${m.statErr.toFixed(1)} vs ${truth.toFixed(1)}`);
      got.push(m.total);
    }
    // the mean of the runs: no bias above 0.6% (the old method's real-data gap was 6-7%)
    const mean = got.reduce((a, v) => a + v, 0) / got.length;
    assert.ok(Math.abs(mean - truth) < 0.006 * truth, `mean ${mean.toFixed(1)} vs ${truth.toFixed(1)}`);
  }
});

test('motion bias: a still star comes out at about 0 and is reported as no significant motion', () => {
  for (const seed of [1, 2, 3]) {
    const { frames, grid } = simulate({ pmra: 0, pmdec: 0, seed });
    const m = measureMotion(frames, grid);
    assert.ok(m.ok, m.reason);
    assert.ok(m.total < 3 * m.statErr + 10 && m.total < 50, `${m.total.toFixed(1)} ± ${m.statErr.toFixed(1)} mas/yr`);
    assert.equal(m.significant, false);
    const s = motionSummary(m);
    assert.match(s.text, /^no significant motion \(< \d+\.\d\d″\/yr\)$/);
  }
});

test('motion bias: annual parallax is removed before the fit (and leaks into it when not)', () => {
  const cfg = { pmra: 3982, pmdec: -2467, ra: 331.04, dec: -56.78, plx: 500, seasons: [2025.4, 2025.9, 2026.4, 2026.85], seed: 4 };
  const truth = Math.hypot(cfg.pmra, cfg.pmdec);
  const a = simulate(cfg), b = simulate({ ...cfg, tagPlx: false });
  const with_ = measureMotion(a.frames, a.grid), without = measureMotion(b.frames, b.grid);
  // same images and noise; only whether the parallax is taken out differs
  assert.ok(Math.abs(with_.total - truth) < Math.max(4 * with_.statErr, 0.015 * truth), `with parallax removed: ${with_.total.toFixed(0)} ± ${with_.statErr.toFixed(0)} vs ${truth.toFixed(0)}`);
  assert.ok(Math.abs(without.total - with_.total) > 50, `parallax leak only ${(without.total - with_.total).toFixed(0)} mas/yr`);
  // Earth's distance from the barycentre stays within 0.98-1.02 AU; the shift is at most plx
  for (let mjd = 60800; mjd < 61200; mjd += 30) {
    const r = Math.hypot(...earthBarycentric(mjd));
    assert.ok(r > 0.98 && r < 1.02, String(r));
    assert.ok(Math.hypot(...parallaxShift(269.45, 4.69, 547, mjd)) <= 0.547 * 1.02);
  }
  assert.deepEqual(parallaxShift(10, 10, 0, 61000), [0, 0]);
});

test('motion bias: saturated-core images are down-weighted, clean ones carry the fit', () => {
  // detectors 1-4 blank the saturated core (like Barnard's Star), 5-6 do not
  const truth = Math.hypot(-800, 10360);
  const { frames, grid } = simulate({ flux: 30000, sat: 2000, satDets: [1, 2, 3, 4], seed: 5 });
  const m = measureMotion(frames, grid);
  assert.ok(m.ok);
  const byMjd = new Map(frames.map(f => [f.mjd, f]));
  const wClean = m.points.filter(p => byMjd.get(p.mjd).detector >= 5).map(p => p.w), wSat = m.points.filter(p => byMjd.get(p.mjd).detector <= 4).map(p => p.w);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(mean(wClean) > 4 * mean(wSat), `weights clean ${mean(wClean).toFixed(1)} vs saturated ${mean(wSat).toFixed(1)}`);
  assert.ok(Math.abs(m.total - truth) < 3 * m.totalErr && Math.abs(m.total - truth) < 150, `${m.total.toFixed(0)} ± ${m.totalErr.toFixed(0)}`);
});

test('motion bias: the systematic floor is folded into the quoted uncertainty', () => {
  const { frames, grid } = simulate({ seed: 6 });
  const m = measureMotion(frames, grid);
  assert.ok(m.sysErr >= SYS_FLOOR_MASYR);
  assert.ok(Math.abs(m.totalErr - Math.hypot(m.statErr, m.sysErr)) < 0.05 * m.totalErr, JSON.stringify({ t: m.totalErr, s: m.statErr, y: m.sysErr }));
  assert.ok(m.pmraErr >= m.sysErr && m.pmdecErr >= m.sysErr);
  assert.equal(m.floor, Math.max(3 * m.totalErr, MIN_MOTION_MASYR));
  // a 3σ-significant but tiny motion (under the control's 0.7″/yr) is not claimed
  const slow = simulate({ pmra: 600, pmdec: 0, seed: 7 });
  const ms = measureMotion(slow.frames, slow.grid);
  assert.ok(ms.total > 3 * ms.totalErr && ms.total < MIN_MOTION_MASYR, `${ms.total.toFixed(0)} ± ${ms.totalErr.toFixed(0)}`);
  assert.equal(ms.significant, false);
  assert.ok(ms.upperLimit >= MIN_MOTION_MASYR);
  assert.match(motionSummary(m).text, /^\d+\.\d\d ± \d+\.\d\d″\/yr$/);
});
