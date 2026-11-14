// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Atmosphere lens (DESIGN.md 31b): transmission lookup, band means, the blocked rule,
// out-of-range handling, curve choice per place, airmass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transAt, bandMean, verdict, curveForPlace, airmass, targetLine, rulerSegments, coverage, BLOCKED_BELOW, OPEN_FROM, RULER } from '../web/app/planet/atmo.js';
import { DEFAULT_BANDS } from '../web/app/bands.js';

const DATA = JSON.parse(readFileSync(new URL('../web/data/atran/transmission.json', import.meta.url)));
// A tiny synthetic curve: 1.00, 1.01, 1.02, 1.03 µm -> 0, 0.5, 1, null
const TOY = { startUm: 1.0, stepUm: 0.01, curves: { x: { t: [0, 0.5, 1, null] } } };

test('data file: four real Gemini ATRAN curves, 0.01 µm steps, values 0–1, with source URLs', () => {
  assert.equal(DATA.stepUm, 0.01); assert.equal(DATA.startUm, 0.9);
  assert.deepEqual(Object.keys(DATA.curves).sort(), ['cp_100_10', 'cp_23_10', 'cp_43_10', 'mk_16_10']);
  for (const c of Object.values(DATA.curves)) {
    assert.match(c.url, /^https:\/\/www\.gemini\.edu\/sciops\/ObsProcess\/obsConstraints\/atm-models\/(mk|cp)trans_zm_\d+_10\.dat$/);
    assert.equal(c.airmass, 1.0);
    assert.ok(c.t.every(v => v === null || (v >= 0 && v <= 1)));
    assert.equal(c.t.length, 421); // 0.90 .. 5.10
  }
  assert.match(DATA.citation, /Lord.*1992.*103957/);
});

test('transAt interpolates linearly between bin centres', () => {
  const c = TOY.curves.x;
  assert.equal(transAt(TOY, c, 1.0), 0);
  assert.ok(Math.abs(transAt(TOY, c, 1.005) - 0.25) < 1e-9);
  assert.ok(Math.abs(transAt(TOY, c, 1.015) - 0.75) < 1e-9);
  assert.equal(transAt(TOY, c, 1.02), 1);
});

test('transAt returns null outside the curve (never invents 0.74–0.90 µm)', () => {
  const mk = DATA.curves.mk_16_10;
  assert.equal(transAt(DATA, mk, 0.80), null);
  assert.equal(transAt(DATA, mk, 0.899), null);
  assert.equal(transAt(DATA, mk, 5.2), null);
  assert.equal(transAt(DATA, mk, NaN), null);
  assert.ok(transAt(DATA, mk, 0.9) > 0.9);
});

test('a missing value next to a real one falls back to the real one, not 0', () => {
  assert.equal(transAt(TOY, TOY.curves.x, 1.025), 1);
});

test('band means: whole band, partial coverage and no overlap', () => {
  const m = bandMean(TOY, TOY.curves.x, 1.0, 1.02);
  assert.ok(Math.abs(m.mean - 0.5) < 1e-6); assert.equal(m.partial, false);
  const mk = DATA.curves.mk_16_10;
  const star = bandMean(DATA, mk, 0.74, 1.11);
  assert.equal(star.partial, true); assert.equal(star.from, 0.9); assert.ok(Math.abs(star.to - 1.11) < 1e-9);
  assert.equal(bandMean(DATA, mk, 0.74, 0.85), null);
  const [c0, c1] = coverage(DATA, mk); assert.equal(c0, 0.9); assert.ok(Math.abs(c1 - 5.1) < 1e-9);
});

test('the blocked rule: under 20% blocked, 20–80% partly, 80%+ open', () => {
  assert.equal(BLOCKED_BELOW, 0.2); assert.equal(OPEN_FROM, 0.8);
  assert.equal(verdict(0.19), 'blocked'); assert.equal(verdict(0.2), 'partly');
  assert.equal(verdict(0.79), 'partly'); assert.equal(verdict(0.8), 'open'); assert.equal(verdict(null), null);
});

test('real physics shows: the 1.4/1.9/2.7 µm water and 4.2–4.3 µm CO₂ gaps are dark, the K window clear', () => {
  for (const c of Object.values(DATA.curves)) {
    assert.ok(bandMean(DATA, c, 4.22, 4.32).mean < BLOCKED_BELOW, 'CO2 4.27 µm');
    assert.ok(bandMean(DATA, c, 2.6, 2.8).mean < BLOCKED_BELOW, 'water 2.7 µm');
    assert.ok(bandMean(DATA, c, 1.36, 1.39).mean < 0.5, 'water 1.38 µm');
    assert.ok(bandMean(DATA, c, 2.1, 2.3).mean > OPEN_FROM, 'K window');
  }
  // wetter air lets less through in every water-affected default band
  const dry = DATA.curves.mk_16_10, wet = DATA.curves.cp_100_10;
  for (const b of DEFAULT_BANDS.slice(1)) assert.ok(bandMean(DATA, wet, b.min, b.max).mean < bandMean(DATA, dry, b.min, b.max).mean, b.name);
});

test('curve choice per place: own curve for Mauna Kea, labelled borrowed curves elsewhere', () => {
  const mk = curveForPlace({ id: 'maunakea', elev: 4205 }, DATA);
  assert.equal(mk.key, 'mk_16_10'); assert.equal(mk.approximate, false);
  const par = curveForPlace({ id: 'paranal', elev: 2635 }, DATA);
  assert.equal(par.key, 'cp_23_10'); assert.equal(par.approximate, true); assert.match(par.how, /approximate, borrowed from Cerro Pachón/);
  assert.equal(curveForPlace({ id: 'kittpeak', elev: 2096 }, DATA).key, 'cp_43_10');
  const col = curveForPlace({ id: 'colombo', elev: 5 }, DATA);
  assert.equal(col.key, 'cp_100_10'); assert.match(col.how, /wettest/);
  const typed = curveForPlace({ id: 'coords', elev: 0 }, DATA);
  assert.equal(typed.key, 'cp_100_10'); assert.match(typed.how, /height not known/);
  assert.equal(curveForPlace({ id: 'x', elev: 5058 }, DATA).approximate, true); // ALMA uses Mauna Kea's, labelled
  assert.equal(curveForPlace({ id: 'x', elev: 10 }, { curves: {} }), null);
});

test('airmass (Kasten & Young): 1 at the zenith, ~2 at 30°, ~38 at the horizon, none below', () => {
  assert.ok(Math.abs(airmass(90) - 1) < 1e-3);
  assert.ok(Math.abs(airmass(30) - 1.995) < 0.01);
  assert.ok(airmass(0.01) > 30 && airmass(0.01) < 40);
  assert.equal(airmass(-1), null); assert.equal(airmass(NaN), null);
  assert.equal(targetLine(54), `Up · 54° high · airmass ${airmass(54).toFixed(2)}`);
  assert.equal(targetLine(-3), 'Below the horizon');
});

test('ruler segments cover 0.74–5.01 µm with no gaps; the uncovered start is marked as no data', () => {
  const segs = rulerSegments(DATA, DATA.curves.cp_43_10);
  assert.equal(segs[0].from, RULER.min); assert.equal(segs[0].block, null); assert.equal(segs[0].to, 0.9);
  assert.ok(Math.abs(segs.at(-1).to - RULER.max) < 1e-9);
  for (let i = 1; i < segs.length; i++) assert.ok(Math.abs(segs[i].from - segs[i - 1].to) < 1e-9);
  assert.ok(segs.slice(1).every(s => s.block >= 0 && s.block <= 1));
});
