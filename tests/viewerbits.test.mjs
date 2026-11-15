// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Tests for web/app/viewerbits.js: Hold one band, the counter, the result plate and the share link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAND_GROUPS, groupOfDet, groupByDets, centreMasked, bestGroup, counterText, plannedIndexOf,
  resultState, storyCaption, shareParams, verdictClass } from '../web/app/viewerbits.js';
import { PRESETS } from '../web/app/presets.js';

test('band groups are detector pairs covering 1–6', () => {
  assert.deepEqual(BAND_GROUPS.flatMap(g => g.dets), [1, 2, 3, 4, 5, 6]);
  assert.equal(groupOfDet(5).label, '3.8–5.0 µm');
  assert.equal(groupByDets([6, 5]).id, 'd56');
  assert.equal(groupByDets([5]), null);
});

test('centreMasked: a blank pixel within 2 px counts, one further out does not', () => {
  const n = 9, d = new Array(n * n).fill(1);
  assert.equal(centreMasked(d, n, 4, 4), false);
  d[4 * n + 6] = null; // 2 px east
  assert.equal(centreMasked(d, n, 4, 4), true);
  const e = new Array(n * n).fill(1); e[4 * n + 7] = NaN; // 3 px east
  assert.equal(centreMasked(e, n, 4, 4), false);
});

test('bestGroup picks the fewest blanked centres (Barnard-like counts -> 5–6), ties to more images', () => {
  const mk = (det, n, m) => Array.from({ length: n }, (_, k) => ({ det, masked: k < m }));
  const barnard = [...mk(1, 20, 20), ...mk(2, 20, 19), ...mk(3, 20, 20), ...mk(4, 19, 19), ...mk(5, 20, 2), ...mk(6, 21, 2)];
  assert.equal(bestGroup(barnard).group.id, 'd56');
  const allBlank = [...mk(1, 37, 37), ...mk(3, 36, 36), ...mk(5, 47, 47)];
  assert.equal(bestGroup(allBlank).group.id, 'd56'); // all 100%: the one with most images
  assert.equal(bestGroup([...mk(1, 3, 0), ...mk(5, 10, 5)]).group.id, 'd56'); // under 6 images: skipped
});

test('every preset names a hold band that is a real group, with a note', () => {
  for (const p of PRESETS) {
    assert.ok(groupByDets(p.holdBand), `${p.key} holdBand`);
    assert.ok(typeof p.holdNote === 'string' && p.holdNote.length > 10, `${p.key} holdNote`);
  }
  assert.deepEqual(PRESETS.find(p => p.key === 'wise-0855').holdBand, [5, 6]);
  assert.match(PRESETS.find(p => p.key === 'wise-0855').holdNote, /invisible at shorter wavelengths/);
});

test('counter: planned position while loading (no jump), "(of N)" when IRSA has more, x / band count when held', () => {
  assert.equal(counterText({ i: 0, shown: 84, loading: true, planned: 120, loaded: 84, plannedIndex: 5 }), '6 / 120 · 84 loaded');
  assert.equal(counterText({ i: 14, shown: 120, loading: false, planned: 120, loaded: 120, total: 358 }), '15 / 120 (of 358)');
  assert.equal(counterText({ i: 14, shown: 120, loading: false, planned: 120, loaded: 120, total: 120 }), '15 / 120');
  assert.equal(counterText({ i: 4, shown: 47, loading: false, held: true, total: 358 }), '5 / 47');
  assert.equal(counterText({ i: 4, shown: 12, loading: true, held: true, planned: 120, loaded: 31, plannedIndex: 17 }), '18 / 120 · 31 loaded');
  assert.equal(counterText({ i: 0, shown: 0, loading: true, planned: 120, loaded: 0 }), '0 / 120 · 0 loaded');
  assert.equal(plannedIndexOf([61000, 61001.5, 61002], 61001.501), 1);
  assert.equal(plannedIndexOf([61000], 61005), -1);
});

test('result state: value, no significant motion, not measurable, failed', () => {
  const mo = { ok: true, total: 10323, totalErr: 274, significant: true, upperLimit: 10871 };
  assert.deepEqual(resultState({ mo, measurable: true, verdict: 'AGREES', catYr: 10.39 }), { kind: 'value', value: '10.32 ± 0.27″/yr', cat: 10.39, verdict: 'AGREES' });
  assert.equal(resultState({ mo, measurable: true, verdict: 'AGREES', catYr: null }).verdict, null); // live spot: no tag
  assert.equal(resultState({ mo: { ...mo, significant: false, upperLimit: 860 }, measurable: true, catYr: null }).value, 'no significant motion (< 0.86″/yr)');
  assert.equal(resultState({ mo, measurable: false, verdict: 'NOT MEASURABLE', catYr: 0.02 }).kind, 'nm');
  assert.equal(resultState({ mo: { ok: false, reason: 'too few frames' } }).kind, 'fail');
  assert.equal(verdictClass('AT THE LIMIT'), 'limit');
});

test('caption numbers come from the fit and the stack dates (1.0 yr apart -> 10.3″, 1.7 px)', () => {
  const c = storyCaption("Barnard's Star", { ok: true, total: 10323, significant: true }, 60950, 60950 + 365.25);
  assert.equal(c.text, "Barnard's Star moved 10.3″ in 1.0 years, about 1.7 pixels.");
  assert.equal(storyCaption('X', { ok: true, total: 500, significant: false }, 1, 400), null);
  // a noisy fit (WISE 0855, 6.53 ± 1.98″/yr): rounded, with its ±, and one pixel in the singular
  assert.equal(storyCaption('WISE 0855', { ok: true, total: 6530, totalErr: 1980, significant: true }, 60950, 60950 + 365.25, 8.15).text, 'WISE 0855 moved about 1 pixel in 1.0 years: about 6.5 ± 2.0″ a year; catalogue 8.2″.');
  assert.equal(storyCaption('X', { ok: true, total: 6150, totalErr: 100, significant: true }, 60950, 60950 + 365.25).text, 'X moved 6.2″ in 1.0 years, about 1 pixel.');
  assert.equal(storyCaption('X', { ok: false }, 1, 400), null);
});

test('share link keeps target, scene, view mode and image date', () => {
  assert.equal(shareParams({ q: "Barnard's Star", scene: 'viewer', mode: 'blink', mjd: 61000.123 }).toString(), 'q=Barnard%27s+Star&scene=viewer&view=blink');
  assert.equal(shareParams({ ra: 10, dec: -5, scene: 'viewer', mode: 'play', mjd: 61000.12346 }).toString(), 'ra=10.00000&dec=-5.00000&scene=viewer&mjd=61000.1235');
  assert.equal(shareParams({ q: 'WISE 0855', scene: 'map' }).toString(), 'q=WISE+0855');
  // Full function test #15: the detector picks the exact image (all six share an exposure time) and the held band is kept
  assert.equal(shareParams({ q: "Barnard's Star", scene: 'viewer', mode: 'play', mjd: 60914.27691, det: 5, band: 'd56' }).toString(), 'q=Barnard%27s+Star&scene=viewer&mjd=60914.2769&det=5&band=d56');
  assert.equal(shareParams({ q: "Barnard's Star", scene: 'viewer', mode: 'play', mjd: 61000.5, band: 'all' }).toString(), 'q=Barnard%27s+Star&scene=viewer&mjd=61000.5000&band=all');
  assert.equal(shareParams({ q: 'WISE 0855', scene: 'map', band: 'd56' }).toString(), 'q=WISE+0855');
});
