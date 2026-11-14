// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Tests for the Ghost (feature C): slider range, tick spacing, offsets, labels, Gaia match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ghostRange, tickStep, ghostTrail, moved, ghostLabel, fmtArc, compass16, pickGaia, hasMotion } from '../web/core/ghost.js';
import { epochYearToMjd } from '../web/core/motion.js';

const barnard = { ra: 269.4520769586187, dec: 4.693364966576667, pmra: -801.551, pmdec: 10362.394, epoch: 2000 };

test('range steps up when the star moves under one pixel in 50 years', () => {
  assert.deepEqual(ghostRange(barnard), { half: 50, step: 1 });
  assert.deepEqual(ghostRange({ pmra: 50, pmdec: 0 }), { half: 500, step: 10 }); // 2.5″ in 50 yr, 25″ in 500
  assert.deepEqual(ghostRange({ pmra: 1, pmdec: 0 }), { half: 5000, step: 100 });
  assert.equal(hasMotion({ pmra: 0, pmdec: 0 }), false);
});

test('ticks: year, decade or century, at most 12', () => {
  assert.equal(tickStep(8), 1);
  assert.equal(tickStep(50), 10);
  assert.equal(tickStep(-500), 100);
  assert.equal(tickStep(5000), 1000);
});

test("Barnard's Star moves ~10.4″ a year, almost due north", () => {
  const m0 = epochYearToMjd(2026);
  const mv = moved(barnard, m0, 10);
  assert.ok(Math.abs(mv.arcsec - 104.2) < 0.5, mv.arcsec);
  assert.equal(mv.dir, 'N');
  const back = moved(barnard, m0, -10);
  assert.equal(back.dir, 'S');
  const tr = ghostTrail(barnard, m0, 25, 10);
  assert.equal(tr.pts.length, 11); assert.equal(tr.step, 10); assert.equal(tr.ticks.length, 2);
});

test('labels and formatting', () => {
  assert.equal(ghostLabel(epochYearToMjd(2026.3), 25), '2051 · +25 yr');
  assert.equal(ghostLabel(epochYearToMjd(2026.3), -1500), '526 · −1,500 yr');
  assert.equal(fmtArc(12.34), '12″');
  assert.equal(fmtArc(260), '4′ 20″');
  assert.equal(fmtArc(3725), '1° 02′');
  assert.equal(compass16(1, 1), 'NE');
  assert.equal(compass16(-1, 0), 'W');
});

test('Gaia match: nearest for a named star, brightest for a patch centre, none if far', () => {
  const rows = [
    { id: 'a', ra: 10, dec: 0, pmra: 5, pmdec: 1, g: 14 },
    { id: 'b', ra: 10 + 3 / 3600, dec: 0, pmra: 50, pmdec: 0, g: 9 },
    { id: 'c', ra: 10, dec: 1 / 3600, pmra: 0, pmdec: 0, g: 5 }, // no motion: never picked
  ];
  assert.equal(pickGaia(rows, { ra: 10, dec: 0 }, 5, 'nearest').id, 'a');
  assert.equal(pickGaia(rows, { ra: 10, dec: 0 }, 5, 'brightest').id, 'b');
  assert.equal(pickGaia(rows, { ra: 11, dec: 0 }, 5), null);
});
