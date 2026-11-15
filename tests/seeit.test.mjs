// "Can you actually see it?" for the five demo targets (Master data decision, Sun 15 Nov 2026).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seeItWith, levelFor } from '../web/app/seeit.js';
import { PRESETS } from '../web/app/presets.js';

const vis = (k) => PRESETS.find(p => p.key === k).vis;

test('thresholds: V<=6 eye, <=9 binoculars, <=13 small telescope, fainter or none = too faint', () => {
  assert.equal(levelFor(6).level, 'eye'); assert.equal(levelFor(6.01).level, 'binoculars');
  assert.equal(levelFor(9).level, 'binoculars'); assert.equal(levelFor(13).level, 'telescope');
  assert.equal(levelFor(13.01).level, 'faint'); assert.equal(levelFor(null).level, 'faint');
});

test('the five demo targets', () => {
  const b = seeItWith(vis('barnard'));
  assert.equal(b.simple, 'To see it: a small telescope.'); assert.equal(b.expert, 'V 9.5 (SIMBAD)');
  assert.match(seeItWith(vis('eps-indi-b')).simple, /too faint for home telescopes: only infrared telescopes like SPHEREx see it/);
  const w = seeItWith(vis('wise-0855'));
  assert.equal(w.level, 'faint'); assert.match(w.expert, /No visible-light/);
  assert.equal(seeItWith(vis('rw-aur')).simple, 'To see it: a small telescope (it varies, V 9.2–12.5).');
  const r = seeItWith(vis('r-dra'));
  assert.equal(r.simple, 'To see it: binoculars at its brightest, too faint for home telescopes at its faintest (it varies, V 6.7–13.2).');
  assert.equal(r.expert, 'V 6.7–13.2 (GCVS)');
});

test('a searched object uses the same rule (Vega, V 0.03)', () => {
  assert.equal(seeItWith({ v: 0.03, source: 'SIMBAD' }).simple, 'To see it: naked eye, from a dark site.');
});
