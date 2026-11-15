// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// "Your photo -> the sky" (web/app/photo): synthetic star fields drawn from Hipparcos at a known
// centre / rotation / scale must solve within 0.5 deg and 2 deg of rotation; the 2-star fallback must fit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareCatalogue, detectStars, solve, sepDeg, upAngle, scaleDeg, fitTwo, checkTwo, quadCode, pixToSky, skyToPix } from '../web/app/photo/solve.js';
import { renderField, makeSolution } from '../web/app/photo/synth.js';

const cat = prepareCatalogue(JSON.parse(readFileSync(new URL('../web/app/data/stars.json', import.meta.url))));
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

const CASES = [
  { name: 'Orion, 50 deg wide, tilted 30 deg', ra: 83.8, dec: 2.0, up: 30, w: 900, h: 600, fov: 50 },
  { name: 'Scorpius, 35 deg wide, tilted 200 deg, portrait', ra: 252, dec: -32, up: 200, w: 600, h: 900, fov: 35 },
  { name: 'Big Dipper, 70 deg wide, tilted 115 deg', ra: 180, dec: 55, up: 115, w: 1000, h: 667, fov: 70 },
  { name: 'Cygnus, 25 deg wide, noisy, stray lights, 20% of stars lost', ra: 305, dec: 40, up: 300, w: 800, h: 600, fov: 25, magLimit: 6.5, noise: 4, extra: 8, drop: 0.2 },
  { name: 'phone-like: Scorpius 75 deg wide, barrel distortion, vignetting, colour scatter, sky glow, lit foreground', ra: 250, dec: -30, up: 170, w: 1200, h: 900, fov: 75, k1: -0.05, vig: 0.4, scatter: 0.3, grad: 30, ground: 0.2, noise: 3 },
  { name: 'phone-like: Big Dipper 90 deg wide, strong barrel distortion, foreground', ra: 165, dec: 55, up: 300, w: 1200, h: 800, fov: 90, k1: -0.08, vig: 0.5, scatter: 0.3, grad: 40, ground: 0.25, noise: 3, magLimit: 4.5 },
];

for (const c of CASES) {
  test(`blind solve: ${c.name}`, async () => {
    const scale = c.fov / Math.max(c.w, c.h);
    const { img, centre } = renderField(cat, { ...c, scale });
    const { stars } = detectStars(img, c.w, c.h);
    const r = await solve(cat, stars, c.w, c.h);
    assert.ok(r.ok, `no solve (${r.reason}, tried ${r.tried}, best ${r.best?.matched}/${r.best?.need})`);
    const off = sepDeg(r.centre.ra, r.centre.dec, centre.ra, centre.dec);
    assert.ok(off < 0.5, `centre off by ${off}`);
    assert.ok(angDiff(r.up, c.up) < 2, `rotation ${r.up} vs ${c.up}`);
    assert.ok(Math.abs(scaleDeg(r.sol) / scale - 1) < (c.k1 ? 0.06 : 0.02), 'scale');
    assert.ok(r.matched >= r.need && r.rmsPx < (c.k1 ? 3 : 1.5), `matched ${r.matched}, rms ${r.rmsPx}`);
    assert.equal(r.mirrored, false);
  });
}

test('the lens hint (field of view) solves the same field', async () => {
  const c = CASES[0], scale = c.fov / c.w, { img, centre } = renderField(cat, { ...c, scale });
  const r = await solve(cat, detectStars(img, c.w, c.h).stars, c.w, c.h, { fov: 48 });
  assert.ok(r.ok && sepDeg(r.centre.ra, r.centre.dec, centre.ra, centre.dec) < 0.5);
  assert.equal(r.band, 48);
});

test('an empty / starless image never claims a solve', async () => {
  const w = 600, h = 400, img = new Float32Array(w * h).fill(20);
  for (let i = 0; i < img.length; i++) img[i] += (i * 7919 % 13) / 3;
  const r = await solve(cat, detectStars(img, w, h).stars, w, h);
  assert.equal(r.ok, false);
});

test('random dots (not a real sky) are not accepted as a solve', async () => {
  const w = 900, h = 600, img = new Float32Array(w * h).fill(14);
  let s = 3; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 60; k++) {
    const x = 10 + rnd() * (w - 20), y = 10 + rnd() * (h - 20), a = 20 + 200 * rnd();
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const X = Math.round(x) + dx, Y = Math.round(y) + dy; img[Y * w + X] += a * Math.exp(-((X - x) ** 2 + (Y - y) ** 2) / 3.4); }
  }
  const r = await solve(cat, detectStars(img, w, h).stars, w, h);
  assert.equal(r.ok, false, `false solve with ${r.matched} matches`);
});

test('2-star fallback: Betelgeuse + Rigel clicked on the Orion photo fits the true transform', () => {
  const c = CASES[0], scale = c.fov / c.w, { img, sol: truth } = renderField(cat, { ...c, scale });
  const iOf = (name) => { for (let i = 0; i < cat.n; i++) if (cat.names[cat.hip[i]] === name) return i; throw new Error(name); };
  const ib = iOf('Betelgeuse'), ir = iOf('Rigel');
  const stars = detectStars(img, c.w, c.h).stars;
  const at = (i) => { const p = skyToPix(truth, cat.ra[i], cat.dec[i]); return stars.reduce((b, s) => (Math.hypot(s.x - p.x, s.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? s : b)); };
  const sol = fitTwo(cat, at(ib), ib, at(ir), ir, c.w, c.h);
  assert.ok(sol);
  const ctr = pixToSky(sol, c.w / 2, c.h / 2), tc = pixToSky(truth, c.w / 2, c.h / 2);
  assert.ok(sepDeg(ctr.ra, ctr.dec, tc.ra, tc.dec) < 0.5, 'centre');
  assert.ok(angDiff(upAngle(sol), c.up) < 2, 'rotation');
  const chk = checkTwo(cat, sol, stars, c.w, c.h);
  assert.ok(chk && chk.ok && chk.matched >= 10, `check matched ${chk?.matched}`);
});

test('2-star fallback: wrong names do not pass the check', () => {
  const c = CASES[0], scale = c.fov / c.w, { img, sol: truth } = renderField(cat, { ...c, scale });
  const iOf = (name) => { for (let i = 0; i < cat.n; i++) if (cat.names[cat.hip[i]] === name) return i; throw new Error(name); };
  const stars = detectStars(img, c.w, c.h).stars;
  const p = (n) => { const i = iOf(n), q = skyToPix(truth, cat.ra[i], cat.dec[i]); return { x: q.x, y: q.y }; };
  const sol = fitTwo(cat, p('Betelgeuse'), iOf('Vega'), p('Rigel'), iOf('Deneb'), c.w, c.h);
  const chk = sol && checkTwo(cat, sol, stars, c.w, c.h);
  assert.ok(!chk || !chk.ok, `wrong names passed with ${chk?.matched}`);
});

test('quad code is the same after rotating, scaling and shifting the four points', () => {
  const P = [[0, 0], [11, 3], [4, 8], [7, -2]], th = 1.1, k = 3.7;
  const Q = P.map(([x, y]) => [k * (x * Math.cos(th) - y * Math.sin(th)) + 50, k * (x * Math.sin(th) + y * Math.cos(th)) - 20]);
  const a = quadCode(P).code, b = quadCode([Q[2], Q[0], Q[3], Q[1]]).code;
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9));
});

test('makeSolution: up angle round-trips', () => {
  for (const up of [0, 45, 190]) assert.ok(angDiff(upAngle(makeSolution({ ra: 10, dec: 10, up, scale: 0.05, w: 100, h: 100 })), up) < 1e-9);
});

test('detection throws out sky seen through a dark silhouette and long streaks, and the photo still solves', async () => {
  const c = { ra: 83.8, dec: 2.0, up: 30, w: 900, h: 600, bg: 30, noise: 2 }, scale = 50 / c.w;
  const { img, centre } = renderField(cat, { ...c, scale });
  const top = Math.round(c.h * 0.62), holes = [], streaks = [];
  for (let y = top; y < c.h; y++) for (let x = 0; x < c.w; x++) img[y * c.w + x] = 3 + ((x * 31 + y * 17) % 5) * 0.4; // tree line
  for (let k = 0; k < 8; k++) { // gaps between leaves: sky-coloured, every other one with a lamp in it
    const hx = 60 + k * 105, hy = top + 40 + (k % 3) * 50; holes.push([hx, hy]);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 7) img[(hy + dy) * c.w + hx + dx] = 30 + (k % 2 ? 120 * Math.exp(-(dx * dx + dy * dy) / 2) : 0);
  }
  for (const [x0, y0, ang] of [[150, 80, 0.3], [600, 150, 2.2], [420, 300, 1.2]]) { // satellite / plane trails
    streaks.push([x0, y0, ang]);
    for (let t = -25; t <= 25; t += 0.5) {
      const x = x0 + t * Math.cos(ang), y = y0 + t * Math.sin(ang);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = Math.round(x) + dx, Y = Math.round(y) + dy; img[Y * c.w + X] = Math.min(255, img[Y * c.w + X] + 12 * Math.exp(-((X - x) ** 2 + (Y - y) ** 2) / 1.3)); }
    }
  }
  const det = detectStars(img, c.w, c.h);
  for (const [hx, hy] of holes) assert.ok(!det.stars.some(s => Math.hypot(s.x - hx, s.y - hy) < 6), `a star was found in the leaf gap at ${hx},${hy}`);
  for (const [x0, y0, ang] of streaks) for (let t = -20; t <= 20; t += 5) {
    const x = x0 + t * Math.cos(ang), y = y0 + t * Math.sin(ang);
    assert.ok(!det.stars.some(s => Math.hypot(s.x - x, s.y - y) < 3), `a star was found on the trail at ${x.toFixed(0)},${y.toFixed(0)}`);
  }
  assert.ok(det.rejected.silhouette > 0 && det.rejected.elongated > 0, JSON.stringify(det.rejected));
  const r = await solve(cat, det.stars, c.w, c.h);
  assert.ok(r.ok && sepDeg(r.centre.ra, r.centre.dec, centre.ra, centre.dec) < 0.5);
});
