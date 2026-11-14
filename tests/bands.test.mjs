// Custom IR band rules.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBand, BandError, channelsFor, layersFor, loadBands, saveBands, resetBands, DEFAULT_BANDS, detectorsFor, sampleChannels, MAX_BANDS } from '../web/app/bands.js';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test("Nithil's example 0.75 to 0.6 µm gets a friendly explanation", () => {
  try { validateBand({ name: 'Test', min: 0.75, max: 0.6, color: '#ff0000' }); assert.fail('should throw'); }
  catch (e) {
    assert.ok(e instanceof BandError);
    assert.match(e.message, /backwards/);
    assert.match(e.message, /0\.6 µm is shorter than SPHEREx can see/);
    assert.match(e.message, /0\.75–5\.01 µm/);
  }
});

test('band validation', () => {
  assert.deepEqual(validateBand({ name: ' Water ice ', min: '2,9', max: '3.2', color: '#33AAFF' }), { name: 'Water ice', min: 2.9, max: 3.2, color: '#33aaff' });
  for (const bad of [{ name: '', min: 1, max: 2, color: '#000000' }, { name: 'x', min: 'a', max: 2, color: '#000000' }, { name: 'x', min: 1, max: 6, color: '#000000' },
    { name: 'x', min: 2, max: 2, color: '#000000' }, { name: 'x', min: 1, max: 2, color: 'red' }])
    assert.throws(() => validateBand(bad), BandError, JSON.stringify(bad));
  const six = Array.from({ length: MAX_BANDS }, () => ({}));
  assert.throws(() => validateBand({ name: 'x', min: 1, max: 2, color: '#000000' }, six), /up to 6/);
  assert.doesNotThrow(() => validateBand({ name: 'x', min: 1, max: 2, color: '#000000' }, six, 'editing'));
});

test('channels and layers', () => {
  assert.deepEqual(channelsFor(0.75, 0.80), [0, 1, 2]);
  assert.deepEqual(channelsFor(1.104, 1.105), [16]); // narrow range -> nearest channel
  assert.equal(channelsFor(0.7455, 5.0096).length, 102);
  assert.deepEqual(sampleChannels([1, 2, 3, 4, 5, 6, 7], 3), [1, 4, 7]);
  const L = layersFor(DEFAULT_BANDS);
  assert.equal(L.length, 3);
  assert.ok(L.every(l => l.channels.length <= 4 && /^[0-9a-f]{6}$/.test(l.color)));
  assert.deepEqual(layersFor(DEFAULT_BANDS.map(b => ({ ...b, on: false }))), []);
  assert.deepEqual(detectorsFor(1.6, 2.5), [2, 3, 4]);
});

test('saved per browser, survives bad data, resets to defaults', () => {
  const s = mem();
  assert.equal(loadBands(s).length, 3);
  const mine = [{ id: 'a', name: 'Mine', min: 1, max: 2, color: '#123456', on: true }];
  assert.ok(saveBands(mine, s));
  assert.deepEqual(loadBands(s), mine);
  s.setItem('spherex-viewer.bands.v1', '{nope');
  assert.equal(loadBands(s).length, 3);
  s.setItem('spherex-viewer.bands.v1', JSON.stringify([{ name: 'evil', min: 0.1, max: 9, color: '#000000' }]));
  assert.deepEqual(loadBands(s), []);
  assert.equal(resetBands(s).length, 3);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(loadBands(broken).length, 3);
  assert.equal(saveBands(mine, broken), false);
});
