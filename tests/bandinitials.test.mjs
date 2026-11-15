// Short text tags for bands, so colour is never the only cue (work order 7).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandInitials, DEFAULT_BANDS } from '../web/app/bands.js';

test('team default bands get distinct short tags', () => {
  const tags = DEFAULT_BANDS.map(bandInitials);
  assert.deepEqual(tags, ['St', 'CS', 'TD', 'WI', 'CO₂', 'BD']);
  assert.equal(new Set(tags).size, tags.length);
});

test('user band names: initials, chemical words kept, never empty', () => {
  const t = n => bandInitials({ name: n });
  assert.equal(t('My dust'), 'MD');
  assert.equal(t('Methane band'), 'Me');
  assert.equal(t('CH4 glow'), 'CH4');
  assert.equal(t('The Dust'), 'Du');
  assert.equal(t('a b c d'), 'BCD');
  assert.equal(t(''), '?');
  assert.equal(bandInitials(null), '?');
  for (const n of ['x', 'Hot', 'Very Long Band Name Here']) assert.ok(t(n).length >= 1 && t(n).length <= 4, n);
});
