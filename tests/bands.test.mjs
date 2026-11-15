// Custom IR band rules.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBand, BandError, channelsFor, layersFor, loadBands, saveBands, resetBands, DEFAULT_BANDS, detectorsFor, sampleChannels, MAX_BANDS, bandTints } from '../web/app/bands.js';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test("Nithil's example 0.75 to 0.6 µm gets a friendly explanation", () => {
  try { validateBand({ name: 'Test', min: 0.75, max: 0.6, color: '#ff0000' }); assert.fail('should throw'); }
  catch (e) {
    assert.ok(e instanceof BandError);
    assert.match(e.message, /backwards/);
    assert.match(e.message, /0\.6 µm is shorter than SPHEREx can see/);
    assert.match(e.message, /0\.74–5\.01 µm/);
  }
});

test('band validation', () => {
  assert.deepEqual(validateBand({ name: ' Water ice ', min: '2,9', max: '3.2', color: '#33AAFF' }), { name: 'Water ice', min: 2.9, max: 3.2, color: '#33aaff' });
  for (const bad of [{ name: '', min: 1, max: 2, color: '#000000' }, { name: 'x', min: 'a', max: 2, color: '#000000' }, { name: 'x', min: 1, max: 6, color: '#000000' },
    { name: 'x', min: 2, max: 2, color: '#000000' }, { name: 'x', min: 1, max: 2, color: 'red' }])
    assert.throws(() => validateBand(bad), BandError, JSON.stringify(bad));
  const six = Array.from({ length: MAX_BANDS }, () => ({}));
  assert.throws(() => validateBand({ name: 'x', min: 1, max: 2, color: '#000000' }, six), /up to 8/);
  assert.doesNotThrow(() => validateBand({ name: 'x', min: 1, max: 2, color: '#000000' }, six, 'editing'));
});

test('channels and layers', () => {
  assert.deepEqual(channelsFor(0.75, 0.80), [0, 1, 2]);
  assert.deepEqual(channelsFor(1.104, 1.105), [16]); // narrow range -> nearest channel
  assert.equal(channelsFor(0.7455, 5.0096).length, 102);
  assert.deepEqual(sampleChannels([1, 2, 3, 4, 5, 6, 7], 3), [1, 4, 7]);
  const L = layersFor(DEFAULT_BANDS);
  assert.equal(L.length, 6);
  assert.ok(L.every(l => l.channels.length <= 4 && /^[0-9a-f]{6}$/.test(l.color)));
  assert.deepEqual(layersFor(DEFAULT_BANDS.map(b => ({ ...b, on: false }))), []);
  assert.deepEqual(detectorsFor(1.6, 2.5), [2, 3, 4]);
});

test('saved per browser, survives bad data, resets to defaults', () => {
  const s = mem();
  assert.equal(loadBands(s).length, 6);
  const mine = [{ id: 'a', name: 'Mine', min: 1, max: 2, color: '#123456', on: true }];
  assert.ok(saveBands(mine, s));
  assert.deepEqual(loadBands(s), mine);
  s.setItem('spherex-viewer.bands.v2', '{nope');
  assert.equal(loadBands(s).length, 6);
  s.setItem('spherex-viewer.bands.v2', JSON.stringify([{ name: 'evil', min: 0.1, max: 9, color: '#000000' }]));
  assert.deepEqual(loadBands(s), []);
  assert.equal(resetBands(s).length, 6);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(loadBands(broken).length, 6);
  assert.equal(saveBands(mine, broken), false);
});

test('team default bands: six, blue to red, no overlaps, cover 0.74–5.01 µm with no gaps', () => {
  assert.deepEqual(DEFAULT_BANDS.map(b => b.name), ['Starlight', 'Cool Stars', 'Through the Dust', 'Water Ice', 'CO₂ Ice', 'Brown Dwarfs']);
  assert.equal(DEFAULT_BANDS[0].min, 0.74);
  assert.equal(DEFAULT_BANDS.at(-1).max, 5.01);
  for (let i = 0; i < DEFAULT_BANDS.length; i++) {
    const b = DEFAULT_BANDS[i];
    assert.ok(b.min < b.max, b.name);
    assert.ok(/^#[0-9a-f]{6}$/.test(b.color) && b.tip.length > 20, b.name);
    assert.doesNotThrow(() => validateBand(b), b.name);
    if (i) assert.equal(b.min, DEFAULT_BANDS[i - 1].max, `${b.name} starts where the previous ends (no gap, no overlap)`);
  }
  const has = (name, um) => { const b = DEFAULT_BANDS.find(x => x.name === name); return b.min < um && um < b.max; };
  assert.ok(has('Water Ice', 3.05) && has('CO₂ Ice', 4.27));
});

test('map tints: each channel in its band colour, split over channels and bands', () => {
  const T = bandTints([{ channels: [1, 2], color: 'ff0000' }, { channels: [9], color: '#00ff00' }], 2);
  assert.deepEqual(T.map(t => t.ch), [1, 2, 9]);
  assert.deepEqual(T[0].rgb, [0.5, 0, 0]); // 2 / 2 bands / 2 channels
  assert.deepEqual(T[2].rgb, [0, 1, 0]);
  assert.deepEqual(bandTints([]), []);
  // all six defaults equally bright: the sum stays near white, never far past it
  const sum = [0, 1, 2].map(i => bandTints(layersFor(DEFAULT_BANDS)).reduce((s, t) => s + t.rgb[i], 0));
  for (const v of sum) assert.ok(v > 0.8 && v < 1.2, String(v));
});
