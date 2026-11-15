// Still-neighbour option of measureMotion (default off): a moving star with a still star inside the
// measuring circle, on synthetic SPHEREx-like images (undersampled PSF with a wing on randomly rolled
// native pixels, redrawn on the display grid as the app does). The light centre is pulled toward the
// still star (motion biased low); the two-source fit with the neighbour at its catalogue position
// recovers the true motion. Geometry like WISE 0855 and its Gaia neighbour (0.7-1.7 px apart).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureMotion, apertureNeighbours } from '../web/app/data.js';
import { makeGrid, reproject, worldToGrid, gridToWorld } from '../web/core/align.js';
import { propagate, epochYearToMjd } from '../web/core/motion.js';
import { tanProject } from '../web/core/wcs.js';

const D2R = Math.PI / 180;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const mass = (a, b, s) => 0.5 * (erf(b / (Math.SQRT2 * s)) - erf(a / (Math.SQRT2 * s)));
// pixel-integrated PSF: Gaussian core (σ 0.55 native px) + 15% broad wing
const psfPix = (dx, dy, s = 0.55) => 0.85 * mass(dx - 0.5, dx + 0.5, s) * mass(dy - 0.5, dy + 0.5, s) + 0.15 * mass(dx - 0.5, dx + 0.5, 3 * s) * mass(dy - 0.5, dy + 0.5, 3 * s);
// that PSF's width on the display grid (σ of a pixel-integrated Gaussian), measured with the same fit
const PSF_GRID = 0.73;

const star = { ra: 133.8189, dec: -7.247, pmra: -8124, pmdec: 673, epoch: 2026 };
const truth = Math.hypot(star.pmra, star.pmdec);
const mjds = [2025.34, 2025.85, 2026.33].flatMap(s0 => Array.from({ length: 12 }, (_, k) => epochYearToMjd(s0 + k * 0.0025)));
const mid = propagate(star, (mjds[0] + mjds[mjds.length - 1]) / 2);
const grid = makeGrid(mid.ra, mid.dec, 150, 6.15);
// the still neighbour: where the star was at 2025.2, 0.7 px north of it (0.7-1.7 px from the star over the images)
const nbAt = (() => { const p = propagate(star, epochYearToMjd(2025.2)); const [x, y] = worldToGrid(grid, p.ra, p.dec); const [ra, dec] = gridToWorld(grid, x, y - 0.7); return { ra, dec, pmra: 0, pmdec: 0, epoch: 2026 }; })();

function simulate({ seed, nbFlux, flux = 60, noise = 1 }) {
  const r = rng(seed), gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const N = 41, scale = 6.15 / 3600, cp = (N - 1) / 2;
  return mjds.map((mjd, k) => {
    const t = propagate(star, mjd);
    const th = r() * 2 * Math.PI, ca = Math.cos(th), sa = Math.sin(th);
    const cra = t.ra + (r() - 0.5) * 2 * scale / Math.cos(t.dec * D2R), cdec = t.dec + (r() - 0.5) * 2 * scale;
    const wcs = { worldToPix(a, d) { const [xi, eta] = tanProject(a, d, cra, cdec); const u = -xi / scale, v = eta / scale; return [cp + ca * u - sa * v, cp + sa * u + ca * v]; } };
    const [tx, ty] = wcs.worldToPix(t.ra, t.dec), [nx, ny] = wcs.worldToPix(nbAt.ra, nbAt.dec);
    const img = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) img[j * N + i] = 5 + flux * psfPix(i - tx, j - ty) + nbFlux * psfPix(i - nx, j - ny) + noise * gauss();
    const f = reproject({ wcs, image: { nx: N, ny: N, data: img }, flags: null }, grid);
    return { n: f.n, data: f.data, mjd, detector: 5 + (k % 2), expected: worldToGrid(grid, t.ra, t.dec), plxShift: null };
  });
}

test('neighbour option: off by default, and an empty list changes nothing', () => {
  const fs = simulate({ seed: 1, nbFlux: 20 });
  const a = measureMotion(fs, grid);
  assert.ok(a.ok);
  assert.deepEqual(measureMotion(fs, grid, { neighbours: [] }), a);
  assert.deepEqual(measureMotion(fs, grid, { neighbours: null }), a);
  assert.equal(a.neighbourFit, undefined);
});

test('apertureNeighbours: still catalogued sources inside the circle around a moving target only', () => {
  const far = (() => { const [ra, dec] = gridToWorld(grid, grid.c + 7, grid.c); return { id: 'far', ra, dec, pmra: 1, pmdec: -2 }; })();
  const comoving = { id: 'comoving', ra: star.ra + 2 / 3600, dec: star.dec, pmra: star.pmra, pmdec: star.pmdec, epoch: 2026 };
  const got = apertureNeighbours(star, [{ id: 'near', ...nbAt }, far, comoving], mjds, grid);
  assert.deepEqual(got.map(s => s.id), ['near']);
  // a still target: a still neighbour cannot bias a motion, so none are picked
  assert.deepEqual(apertureNeighbours({ ...star, pmra: 7, pmdec: -20 }, [{ id: 'near', ...nbAt }], mjds, grid), []);
});

test('neighbour option: light centre biased low by a still neighbour; the two-source fit recovers the motion', () => {
  const r0 = [], r1 = [];
  for (const seed of [1, 2, 3]) {
    const fs = simulate({ seed, nbFlux: 20 }); // neighbour = 25% of the light in the circle
    const m0 = measureMotion(fs, grid), m1 = measureMotion(fs, grid, { neighbours: [nbAt], psfSigma: PSF_GRID });
    assert.ok(m0.ok && m1.ok, JSON.stringify([m0.reason, m1.reason]));
    assert.equal(m1.neighbourFit.n, 1);
    assert.ok(m0.total < 0.9 * truth && truth - m0.total > 3 * m0.statErr, `seed ${seed}: light centre ${m0.total.toFixed(0)} ± ${m0.statErr.toFixed(0)} vs ${truth.toFixed(0)} (expected biased low)`);
    assert.ok(Math.abs(m1.total - truth) < Math.max(3 * m1.statErr, 0.05 * truth), `seed ${seed}: fit ${m1.total.toFixed(0)} ± ${m1.statErr.toFixed(0)} vs ${truth.toFixed(0)}`);
    r0.push(m0.total / truth); r1.push(m1.total / truth);
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(Math.abs(mean(r1) - 1) < 0.04, `fit mean ratio ${mean(r1).toFixed(3)}`);
  assert.ok(mean(r0) < 0.9, `light-centre mean ratio ${mean(r0).toFixed(3)}`);
});

test('neighbour option: a listed neighbour with no light does not bias the fit', () => {
  for (const seed of [4, 5]) {
    const fs = simulate({ seed, nbFlux: 0 });
    const m1 = measureMotion(fs, grid, { neighbours: [nbAt], psfSigma: PSF_GRID });
    assert.ok(m1.ok);
    assert.ok(Math.abs(m1.total - truth) < Math.max(3 * m1.statErr, 0.05 * truth), `seed ${seed}: ${m1.total.toFixed(0)} ± ${m1.statErr.toFixed(0)} vs ${truth.toFixed(0)}`);
  }
});
