// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Image colours and marks colour (Nithil, 15 Nov): every image ramp's lightness rises strictly (OKLab L), each colour mode
// picks its own safe image ramp, ring and Difference colours, and the visitor's own pick wins over the mode's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { diffColor } from '../web/app/diffview.js';

function render(dataset = {}) {
  const ctx = { window: { matchMedia: () => ({ matches: false }) }, document: { documentElement: { dataset } } };
  vm.runInNewContext(readFileSync(new URL('../web/app/erender.js', import.meta.url), 'utf8'), ctx);
  return ctx.window.MockRender;
}
// access.js is a classic browser script: run it against a small stand-in page with a saved state
function access(saved, contrast = false) {
  const vars = {}, root = { dataset: contrast ? { contrast: 'more' } : {}, style: { setProperty: (k, v) => { vars[k] = v; }, removeProperty: k => { delete vars[k]; } }, dispatchEvent() {} };
  const store = { 'star-shift-access-v1': saved ? JSON.stringify(saved) : null };
  const document = { documentElement: root, readyState: 'complete', head: { appendChild() {} }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) };
  const ctx = { document, window: {}, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, addEventListener() {} };
  vm.runInNewContext(readFileSync(new URL('../web/app/access.js', import.meta.url), 'utf8'), ctx);
  return { A: ctx.window.StarShiftAccess, ds: root.dataset, vars };
}
const BY = { preset: 'by', look: 'volt', p: '#2B2622', s: '#00707A', t: '#B3123E' };
const RG = { preset: 'rg', look: 'volt', p: '#2B2622', s: '#0072B2', t: '#D55E00' };

test('every image ramp rises strictly in OKLab lightness, Custom too for several hues', () => {
  for (const id of ['ice', 'copper', 'grey', 'magma', 'viridis']) {
    const R = render({ axImg: id });
    assert.equal(R.lookRamp('copper'), id);
    let prev = -1;
    for (let i = 0; i <= 64; i++) { const L = R.oklabL(R.rampRGB('copper', i / 64)); assert.ok(L > prev, `${id} at ${i}/64`); prev = L; }
  }
  for (const hue of ['#E040A0', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#808080']) {
    const R = render({ axImg: 'custom', axImgHue: hue });
    assert.equal(R.lookRamp('copper'), 'custom');
    let prev = -1;
    for (let i = 0; i <= 64; i++) { const L = R.oklabL(R.rampRGB('copper', i / 64)); assert.ok(L > prev, `custom ${hue} at ${i}/64`); prev = L; }
    assert.ok(R.oklabL(R.rampRGB('copper', 0)) < 0.15 && R.oklabL(R.rampRGB('copper', 1)) > 0.95, 'black to white');
  }
});

test('each colour mode maps to its default image ramp, ring and Difference', () => {
  const cases = [
    [null, false, 'ice', undefined, 'by'],
    [{ preset: 'classic', look: 'classic', p: '#8A4719', s: '#46604A', t: '#A4452F' }, false, 'copper', undefined, 'by'],
    [BY, false, 'magma', '#FF4FD8', 'rt'],
    [RG, false, 'viridis', undefined, 'by'],
    [null, true, 'grey', '#FFFFFF', 'by']
  ];
  for (const [saved, hc, img, ring, diff] of cases) {
    const { ds, vars } = access(saved, hc);
    assert.equal(ds.axImg, img, JSON.stringify(saved) + hc);
    assert.equal(ds.axMark, ring);
    assert.equal(ds.axDiff, diff);
    if (ring) assert.equal(vars['--ring'], ring); // the canvas ring reads --ring (ui.js opt)
  }
  // the erender guide cross follows the marks colour
  assert.equal(render({ axMark: '#FF4FD8' }).crossColor(), '#FF4FD8');
  assert.equal(render({}).crossColor(), 'rgba(255,255,255,.7)');
});

test("the visitor's own image and marks colours win over the mode's", () => {
  const { ds, vars } = access({ ...BY, img: 'viridis', mark: '#33E0FF' });
  assert.equal(ds.axImg, 'viridis');
  assert.equal(ds.axMark, '#33E0FF');
  assert.equal(vars['--ring'], '#33E0FF');
  assert.equal(ds.axDiff, 'rt');
  const hc = access({ img: 'magma' }, true);
  assert.equal(hc.ds.axImg, 'magma'); // even over high contrast
  const bad = access({ img: 'nope', mark: 'red' });
  assert.equal(bad.ds.axImg, 'ice'); assert.equal(bad.ds.axMark, undefined);
});

test('Difference in tritanopia mode is red (brighter), dark, teal (fainter); default stays yellow / blue', () => {
  const [r, g, b] = diffColor(1, false, true), [r2, g2, b2] = diffColor(-1, false, true);
  assert.ok(r > g && r > b, 'brighter is red');
  assert.ok(g2 > r2 + 60 && b2 > r2 + 60, 'fainter is teal');
  const [yr, yg, yb] = diffColor(1, false, false), [br, , bb] = diffColor(-1, false, false);
  assert.ok(yr > yb && yg > yb, 'brighter is yellow'); assert.ok(bb > br, 'fainter is blue');
  assert.deepEqual(diffColor(0, false, true), diffColor(0, false, false)); // the same dark centre
});
