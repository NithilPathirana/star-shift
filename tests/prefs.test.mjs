// Clarity defaults and saved choices (work order 7: sounds off by default).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clarityDefaults, readClarity, CLARITY_KEY } from '../web/app/prefs.js';

test('new visitors: sounds off, normal text, OS hints respected', () => {
  const d = readClarity(null, { reduceMotion: true });
  assert.equal(d.sounds, false);
  assert.equal(d.text, false);
  assert.equal(d.motion, true);
  assert.equal(d.glass, false);
  assert.deepEqual(readClarity(null), clarityDefaults());
  assert.equal(CLARITY_KEY, 'tgi-clarity-v1'); // shared with every page
});

test('legacy default-on `sound` is ignored; only an explicit choice turns sounds on', () => {
  const old = readClarity('{"sound":true,"text":true}');
  assert.equal(old.sounds, false);
  assert.equal('sound' in old, false);
  assert.equal(old.text, true); // other choices survive
  assert.equal(readClarity('{"sounds":true}').sounds, true);
  assert.equal(readClarity('{"sounds":"yes"}').sounds, false);
});

test('bad or odd storage never throws and falls back to defaults', () => {
  for (const raw of ['{', 'null', '[]', '42', '"x"', '']) assert.deepEqual(readClarity(raw), clarityDefaults());
});

test('saved choices override defaults', () => {
  const s = readClarity('{"ring":false,"str":"linear","sounds":true}');
  assert.equal(s.ring, false); assert.equal(s.str, 'linear'); assert.equal(s.sounds, true); assert.equal(s.hatch, true);
});
