// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// b2 on a slow link: images are fetched ends-first, and a preset's Blink starts once the first and last seasons have images.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endsFirst } from '../web/app/data.js';
import { earlyBlinkReady } from '../web/app/viewerbits.js';

test('endsFirst: first, last, second, second-last, … and every item once', () => {
  assert.deepEqual(endsFirst([1, 2, 3, 4, 5]), [1, 5, 2, 4, 3]);
  assert.deepEqual(endsFirst([1, 2, 3, 4]), [1, 4, 2, 3]);
  assert.deepEqual(endsFirst([7]), [7]);
  assert.deepEqual(endsFirst([]), []);
  const a = Array.from({ length: 120 }, (_, k) => k);
  assert.deepEqual(endsFirst(a).slice().sort((x, y) => x - y), a);
});

test('earlyBlinkReady: needs the plan\'s first and last season, each with enough images', () => {
  const d = mjd => new Date((mjd - 40587) * 864e5);
  const st = (a, b, count) => ({ start: d(a), end: d(b), count });
  const mjds = [60800, 60805, 60990, 61000, 61160, 61170]; // three seasons
  assert.equal(earlyBlinkReady([st(60800, 60805, 3), st(61160, 61170, 5)], mjds), true);
  assert.equal(earlyBlinkReady([st(60800, 60805, 2), st(61160, 61170, 5)], mjds), false, 'too few in the first');
  assert.equal(earlyBlinkReady([st(60800, 60805, 6), st(60990, 61000, 6)], mjds), false, 'last season not in yet');
  assert.equal(earlyBlinkReady([st(60800, 60805, 6)], mjds), false, 'one stack');
  assert.equal(earlyBlinkReady([], mjds), false);
  assert.equal(earlyBlinkReady(null, mjds), false);
});

test('heldFitText (QA a3): explains "x / 47" against the fit\'s 28 only when the fit uses the held detectors', async () => {
  const { heldFitText } = await import('../web/app/viewerbits.js');
  const mo = { ok: true, frames: 28, detectors: [5, 6] };
  const t = heldFitText({ shown: 47, label: '3.8–5.0 µm', mo, heldDets: [5, 6], name: 'WISE 0855' });
  assert.match(t.tip, /47 images at 3\.8–5\.0 µm; the motion fit uses the 28 where WISE 0855 is clearly detected/);
  assert.match(t.line, /28 of these 47 images/);
  assert.equal(heldFitText({ shown: 41, label: 'x', mo: { ok: true, frames: 100, detectors: null }, heldDets: [5, 6], name: 'B' }), null, 'fit on all bands');
  assert.equal(heldFitText({ shown: 47, label: 'x', mo: { ...mo, detectors: [1, 2] }, heldDets: [5, 6], name: 'W' }), null, 'other detectors');
  assert.equal(heldFitText({ shown: 28, label: 'x', mo, heldDets: [5, 6], name: 'W' }), null, 'fit uses them all');
  assert.equal(heldFitText({ shown: 47, label: 'x', mo: { ok: false }, heldDets: [5, 6], name: 'W' }), null);
});
