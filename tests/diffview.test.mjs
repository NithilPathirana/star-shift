// Tests for web/app/diffview.js (Compare > Difference, Judging panel b6).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffImage, diffStar, diffCaption, diffColor, dirOf, diffLegend, diffKeyTitle, toLab } from '../web/app/diffview.js';

// a Gaussian star on a flat sky, n x n, centred at (cx, cy)
function star(n, cx, cy, flux = 100, sky = 5, sigma = 1.2) {
  const d = new Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    d[y * n + x] = sky + flux * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma));
  return d;
}

test('diffImage: later minus earlier, each sky level removed, no-data stays null, symmetric 99th-percentile scale', () => {
  const n = 21, a = star(n, 10, 10, 100, 5), b = star(n, 10, 10, 100, 9); // same star, brighter sky later
  a[0] = null; b[1] = NaN;
  const img = diffImage(a, b, n);
  assert.equal(img.d[0], null); assert.equal(img.d[1], null);
  assert.ok(Math.abs(img.d[10 * n + 10]) < 1e-9, 'a brighter sky alone is no change');
  assert.equal(img.valid, n * n - 2);
  assert.ok(img.scale > 0);
});

test('a star that moves 2 px north shows a +/- pair along its motion: blue where it was, copper where it went', () => {
  const n = 21, a = star(n, 10, 11), b = star(n, 10, 9); // y grows southwards: 11 -> 9 is north
  const img = diffImage(a, b, n), s = diffStar(img, a, [10, 10], 5);
  assert.equal(s.kind, 'moved');
  assert.equal(s.dir, 'north');
  assert.ok(s.dy < -1 && Math.abs(s.dx) < 0.2, `lobes ${s.dx.toFixed(2)}, ${s.dy.toFixed(2)}`);
  assert.ok(img.d[9 * n + 10] > 0 && img.d[11 * n + 10] < 0);
  assert.match(diffCaption(s, "Barnard's Star"), /moved north/);
});

test('a star that only brightens shows no pair: one colour, the change in per cent', () => {
  const n = 21, a = star(n, 10, 10, 100), b = star(n, 10, 10, 140);
  const s = diffStar(diffImage(a, b, n), a, [10, 10], 5);
  assert.equal(s.kind, 'brighter');
  assert.ok(Math.abs(s.net - 0.4) < 0.05, `net ${s.net}`);
  assert.match(diffCaption(s, 'RW Aurigae', true), /no visible motion.*copper.*40% brighter/);
  assert.match(diffCaption(s, 'RW Aurigae'), /no visible motion.*yellow.*40% brighter/); // default (blue) look
  const f = diffStar(diffImage(a, star(n, 10, 10, 60), n), a, [10, 10], 5);
  assert.equal(f.kind, 'fainter'); assert.match(diffCaption(f, 'X'), /blue.*40% fainter/);
});

test('a steady star is "same"; no star light is "unclear"', () => {
  const n = 21, a = star(n, 10, 10), b = a.map((v, k) => v + (k % 2 ? 0.2 : -0.2));
  assert.equal(diffStar(diffImage(a, b, n), a, [10, 10], 5).kind, 'same');
  const flat = new Array(n * n).fill(3);
  assert.equal(diffStar(diffImage(flat, flat, n), flat, [10, 10], 5).kind, 'unclear');
  assert.match(diffCaption(null, '', true), /Copper: brighter/);
  assert.match(diffCaption(null), /Yellow: brighter/);
});

test('directions on the sky grid (north up, east left)', () => {
  assert.equal(dirOf(0, -1), 'north'); assert.equal(dirOf(-1, 0), 'east');
  assert.equal(dirOf(0, 1), 'south'); assert.equal(dirOf(1, 0), 'west'); assert.equal(dirOf(-1, -1), 'north-east');
});

test('diverging colours (classic look): grey at zero, copper above, blue below, same strength both ways', () => {
  const C = t => diffColor(t, true);
  const z = C(0), up = C(1), dn = C(-1), half = C(0.5), mhalf = C(-0.5);
  assert.deepEqual(z, [52, 46, 41]);
  assert.ok(up[0] > up[2] && half[0] > half[2], 'copper: red over blue');
  assert.ok(dn[2] > dn[0] && mhalf[2] > mhalf[0], 'blue: blue over red');
  assert.deepEqual(C(5), up, 'clipped at the scale');
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(Math.abs(lum(half) - lum(mhalf)) < 40, 'both sides lift about equally');
});

test('legend: plain words, and in Expert the scale ends too', () => {
  const h = diffLegend({ scale: 0.0123 });
  assert.match(h, /Later minus earlier/); assert.match(h, />fainter</); assert.match(h, />brighter</);
  assert.match(h, /x-only">colour scale ±0\.012 MJy\/sr/);
  assert.match(diffLegend({ scale: 279.9 }), /±280 MJy/);
});

test('diverging colours (default blue look): dark #1A2233 at zero, blue below, yellow above, lightness symmetric, no orange', () => {
  const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  assert.equal(hex(diffColor(0)), '#1A2233', 'no change blends into the navy stage');
  assert.deepEqual(diffColor(-5), diffColor(-1), 'clipped at the scale');
  const L = c => toLab(c)[0], hue = c => { const l = toLab(c); return Math.atan2(l[2], l[1]) * 180 / Math.PI; };
  let pl = L(diffColor(0));
  for (let i = 1; i <= 50; i++) {
    const up = diffColor(i / 50), dn = diffColor(-i / 50);
    assert.ok(Math.abs(L(up) - L(dn)) < 0.03, `same lightness both sides at ${i / 50}`);
    assert.ok(L(up) > pl - 1e-6, 'lightness rises with |difference|'); pl = L(up);
    if (i >= 5) { assert.ok(dn[2] > dn[0], 'below zero is blue'); assert.ok(up[0] > up[2] && up[1] > up[2], 'above zero is yellow'); }
  }
  assert.ok(L(diffColor(1)) > 0.8 && L(diffColor(-1)) > 0.8, 'both ends bright');
  assert.match(diffCaption(null), /Dark: no change/);
  assert.match(diffKeyTitle(), /Yellow = brighter later, blue = fainter later/);
  assert.match(diffKeyTitle(true), /Copper = brighter later/);
  assert.match(diffLegend({ scale: 1 }), /title="Yellow = brighter later/);
});
