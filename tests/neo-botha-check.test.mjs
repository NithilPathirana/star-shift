// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// The Asteroids page's measured Botha check: words come from web/data/botha-check.json (made by
// tools/botha_check.mjs), only a 'seen' verdict changes them, and they never claim a detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bothaCheckText, checkAppliesTo } from '../web/app/neo/botha-check.js';

const check = JSON.parse(readFileSync(new URL('../web/data/botha-check.json', import.meta.url), 'utf8'));

test('botha-check.json: every visit image measured with its own JPL place, controls from other dates', () => {
  assert.equal(check.object, '1354 Botha');
  assert.equal(check.exposures.length, check.summary.measured);
  for (const r of check.exposures) {
    assert.ok(Number.isFinite(r.snr) && Number.isFinite(r.peakOffsetPx), r.image);
    assert.equal(r.seen, r.snr >= 5 && r.peakOffsetPx <= 1, r.image);
    assert.ok(r.utc.startsWith(check.date), r.image);
  }
  assert.equal(new Set(check.exposures.map(r => r.predicted.ra)).size, check.visit.exposures.length); // one place per exposure time
  assert.ok(check.control.images.every(r => !r.utc.startsWith(check.date) && r.bothaAwayArcmin > 5));
  assert.equal(check.control.seen, check.control.images.filter(r => r.seen).length);
});

test('the page words carry the computed numbers and never claim a detection', () => {
  const w = bothaCheckText(check);
  assert.ok(w, 'the saved check supports the wording');
  const { summary: s, control: c } = check;
  assert.match(w.expert, new RegExp(`a dot in ${s.seen} of ${s.measured} images`));
  assert.match(w.expert, new RegExp(`S/N ${s.snrMin.toFixed(1)}–${s.snrMax.toFixed(1)}`));
  assert.match(w.simple, new RegExp(`${s.seen} of ${s.measured} pictures, and nothing there in ${c.measured} pictures`));
  for (const t of Object.values(w)) assert.doesNotMatch(t, /\b(found|caught|detected|detection|discovered)\b/i);
});

test('anything short of a clear result keeps the prediction wording', () => {
  assert.equal(bothaCheckText(null), null);
  assert.equal(bothaCheckText({ ...check, verdict: 'not-clear' }), null);
  assert.equal(bothaCheckText({ ...check, control: { ...check.control, seen: 1 } }), null);
  assert.equal(bothaCheckText({ ...check, summary: { ...check.summary, seen: check.summary.measured - 2 } }), null);
});

test('the row note goes on Botha at the measured visit only', () => {
  const time = { covered: true, exposure: check.visit.exposures[1] };
  assert.equal(checkAppliesTo(check, { name: '1354 Botha (1935 GK)', date: check.date, time }), true);
  assert.equal(checkAppliesTo(check, { name: '13540 Other (2000 AB)', date: check.date, time }), false);
  assert.equal(checkAppliesTo(check, { name: '1354 Botha (1935 GK)', date: '2026-06-15', time }), false);
  assert.equal(checkAppliesTo(check, { name: '1354 Botha (1935 GK)', date: check.date, time: { covered: false } }), false);
});
