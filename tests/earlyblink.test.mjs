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
