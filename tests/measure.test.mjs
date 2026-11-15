// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// "Measure it yourself" (web/app/measure/logic.js, design/spec-team-extras.md item 1): the speed maths a
// student's two clicks go through, the comparison with our fit and Gaia, and the teacher's sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../web/app/measure/logic.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (±${tol})`);

test('clicks map to grid pixels and back (pixel centres at (i + 0.5) × cell)', () => {
  const rect = { left: 100, top: 50, width: 300, height: 300 }; // 15 px grid, 20 CSS px per pixel
  assert.deepEqual(M.clickToGrid(110, 60, rect, 15), { x: 0, y: 0 });
  assert.deepEqual(M.clickToGrid(250, 200, rect, 15), { x: 7, y: 7 });
  const g = M.gridToClient(3.3, 9.6, rect, 15), back = M.clickToGrid(g.clientX, g.clientY, rect, 15);
  near(back.x, 3.3, 1e-9); near(back.y, 9.6, 1e-9);
});

test('offset: pixels × 6.15″, east is left and north is up on the grid', () => {
  const o = M.offsetOf({ x: 7, y: 7 }, { x: 7, y: 5 }, 6.15); // 2 px straight up
  near(o.px, 2, 1e-12); near(o.arcsec, 12.3, 1e-12); near(o.north, 12.3, 1e-12); near(o.east, 0, 1e-12);
  near(o.pa, 0, 1e-9); assert.equal(M.compassWord(o.pa), 'north');
  const w = M.offsetOf({ x: 7, y: 7 }, { x: 4, y: 11 }, 6.15); // 3 left (east), 4 down (south): a 3-4-5 triangle
  near(w.px, 5, 1e-12); near(w.arcsec, 30.75, 1e-12); near(w.east, 18.45, 1e-12); near(w.north, -24.6, 1e-12);
  assert.equal(M.compassWord(w.pa), 'south-east');
  assert.equal(M.offsetOf({ x: 1, y: 1 }, { x: 1, y: 1 }, 6.15).pa, null); // no shift: no direction
});

test('speed = offset ÷ years between the two stack dates', () => {
  // 1.69 px north over exactly one year at 6.15″/px = 10.39″/yr, about Gaia's value for Barnard's Star
  const r = M.speedOf({ x: 7, y: 7.85 }, { x: 7, y: 6.16 }, 60900, 60900 + 365.25, 6.15);
  near(r.years, 1, 1e-12); near(r.speed, 1.69 * 6.15, 1e-9);
  // order of the dates does not change the speed; half the time doubles it
  near(M.speedOf({ x: 0, y: 0 }, { x: 1, y: 0 }, 61000, 60000, 6.15).speed, 6.15 / (1000 / 365.25), 1e-9);
  near(M.speedOf({ x: 0, y: 0 }, { x: 1, y: 0 }, 0, 182.625, 6.15).speed, 12.3, 1e-9);
  assert.equal(M.speedOf({ x: 0, y: 0 }, { x: 1, y: 0 }, 5, 5, 6.15).speed, null); // same date: no speed
  near(M.pixelWorth(6.15, 0.981), 6.269, 1e-3);
});

test('comparison: σ against the fit, pixels of clicking, Gaia percent, friendly tier', () => {
  const fit = { value: 10.32, err: 0.27 }, opts = { scale: 6.15, years: 1 };
  const a = M.compareSpeed(10.48, fit, 10.39, opts);
  near(a.diff, 0.16, 1e-9); near(a.sigmas, 0.16 / 0.27, 1e-9); assert.equal(a.tier, 'bullseye');
  near(a.gaiaPct, 100 * 0.09 / 10.39, 1e-9); assert.ok(a.gaiaDiff > 0);
  near(a.yourErr, Math.SQRT2 * 0.25 * 6.15, 1e-9);
  const b = M.compareSpeed(10.32 - 1.0, fit, 10.39, opts); // 1″/yr slow = 0.16 px: very close
  assert.ok(b.diff < 0); near(b.pxOff, 1 / 6.15, 1e-9); assert.equal(b.tier, 'close');
  assert.equal(M.compareSpeed(10.32 + 2.5, fit, 10.39, opts).tier, 'good'); // 0.41 px
  assert.equal(M.compareSpeed(10.32 + 5, fit, 10.39, opts).tier, 'near'); // 0.81 px
  assert.equal(M.compareSpeed(0, fit, 10.39, opts).tier, 'off'); // clicked the same spot twice
  assert.equal(M.compareSpeed(10, null, 10.39, opts), null);
  for (const t of ['bullseye', 'close', 'good', 'near', 'off']) assert.ok(M.TIER_WORDS[t]?.head && M.TIER_WORDS[t]?.body, t);
});

test("fit and Gaia values come from the real proof.json (Barnard's Star)", () => {
  const proof = JSON.parse(readFileSync(new URL('../web/data/proof.json', import.meta.url), 'utf8'));
  const r = M.fitFromProof(proof, 'barnard');
  assert.ok(r.fit && r.fit.value > 9 && r.fit.value < 11.5 && r.fit.err > 0 && r.fit.err < 1, JSON.stringify(r));
  assert.ok(r.gaia > 10.3 && r.gaia < 10.5, String(r.gaia));
  assert.deepEqual(M.fitFromProof(null, 'barnard'), { fit: null, gaia: null, source: null });
});

test("the teacher's sheet has every step, blanks before measuring and the numbers after", () => {
  const blank = M.sheetMarkdown({ scale: 6.15 });
  for (const h of ['## 1.', '## 2.', '## 3.', '## 4.', '## 5.']) assert.ok(blank.includes(h), h);
  assert.ok(blank.includes('______') && !/NaN|undefined|null/.test(blank));
  const r = M.speedOf({ x: 7, y: 7.85 }, { x: 7, y: 6.16 }, 60900, 61258, 6.15);
  const cmp = M.compareSpeed(r.speed, { value: 10.32, err: 0.27 }, 10.39, { scale: 6.15, years: r.years });
  const md = M.sheetMarkdown({ scale: 6.15, a: { x: 7, y: 7.85 }, b: { x: 7, y: 6.16 }, result: r, cmp, fit: { value: 10.32, err: 0.27 }, gaia: 10.39,
    first: { from: '2025-08-15', to: '2025-10-01' }, last: { from: '2026-08-16', to: '2026-09-22' } });
  assert.ok(md.includes(`**${r.speed.toFixed(2)}″ per year**`) && md.includes('(−1.69)²') && md.includes('10.32 ± 0.27'));
  assert.ok(!/NaN|undefined|null/.test(md));
  assert.equal(M.sq(-1.5), '(−1.50)²'); assert.equal(M.sq(0.25), '0.25²');
});

test('the page follows the shell: consent.js first in <head>, one SI credit line, linked from Help and the viewer', () => {
  const html = readFileSync(new URL('../web/measure.html', import.meta.url), 'utf8');
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  assert.ok(head.indexOf('app/consent.js') > 0 && head.indexOf('app/consent.js') < head.indexOf('<link') && head.indexOf('app/consent.js') < head.indexOf('app/access.js'));
  assert.equal((html.match(/class="ai-credit"/g) || []).length, 1);
  assert.ok(html.includes('class="rail"') && html.includes('app/rail.js') && html.includes('app/measure/main.js'));
  assert.ok(readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').includes('href="measure.html"'), 'Help links to the page');
  assert.ok(readFileSync(new URL('../web/app/ui.js', import.meta.url), 'utf8').includes('measure.html'), "Barnard's viewer card links to the page");
});
