// Tests for the app logic: input parsing, URLs, state, planning, display maths.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, QueryError, fromURL, toURL, DEFAULT_SETTINGS, formatRA, formatDec, validSetting } from '../web/app/query.js';
import { reducer, initialState, createStore } from '../web/app/state.js';
import { spread, cutoutSizeDeg, cutoutCenter, seasons, buildStacks, resolveTarget, run } from '../web/app/data.js';
import { stretchToBytes, fillHoles } from '../web/app/render.js';
import { findPreset, PRESETS } from '../web/app/presets.js';

const close = (a, b, tol = 1e-5) => Math.abs(a - b) < tol;

test('coordinates in many formats', () => {
  const cases = [
    ['269.45 4.69', 269.45, 4.69],
    ['269.45, -4.69', 269.45, -4.69],
    ['269.45 +4.69', 269.45, 4.69],
    ['17 57 48.5 +04 41 36', 269.452083, 4.693333],
    ['17:57:48.5 +04:41:36', 269.452083, 4.693333],
    ['17h57m48.5s +04d41m36s', 269.452083, 4.693333],
    ['17h 57m 48.5s, +4° 41′ 36″', 269.452083, 4.693333],
    ['08h55m10.831s -7d14m42.53s', 133.795129, -7.245147],
    ['08 55 10.831 −07 14 42.53', 133.795129, -7.245147],
    ['00 30 00 -00 30 00', 7.5, -0.5],
    ['17.963h +4.69', 269.445, 4.69],
    ['0 0', 0, 0],
    ['360 0', 0, 0],
  ];
  for (const [txt, ra, dec] of cases) {
    const q = parseQuery(txt);
    assert.equal(q.type, 'coords', txt);
    assert.ok(close(q.ra, ra, 1e-5) && close(q.dec, dec, 1e-5), `${txt} -> ${q.ra}, ${q.dec}`);
  }
});

test('names are names', () => {
  for (const n of ["Barnard's Star", 'R Dra', 'eps Ind B', 'WISE J085510.83-071442.5', '61 Cyg', '2MASS J04151954-0935066', 'HD 209100', 'M31'])
    assert.deepEqual(parseQuery(n), { type: 'name', name: n });
});

test('friendly errors for bad input', () => {
  for (const bad of ['', '   ', '400 10', '10 95', '17 61 00 +04 00 00', '1 2 3', '25h00m00s +00d00m00s', '<script>', 'a'.repeat(90), '12 -91'])
    assert.throws(() => parseQuery(bad), QueryError, JSON.stringify(bad));
  try { parseQuery('10 95'); } catch (e) { assert.match(e.message, /Dec/); }
});

test('formatting RA/Dec', () => {
  assert.equal(formatRA(269.452083), '17h 57m 48.50s');
  assert.equal(formatDec(-7.245147), '−07° 14′ 42.5″');
});

test('URL round trip and unknown values ignored', () => {
  const q = { type: 'coords', ra: 269.45, dec: -4.69 };
  const s = { ...DEFAULT_SETTINGS, fov: 20, stretch: 'log' };
  const url = toURL(q, s);
  assert.equal(url, '?ra=269.45000&dec=-4.69000&fov=20&stretch=log');
  const back = fromURL(url);
  assert.ok(close(back.query.ra, 269.45) && close(back.query.dec, -4.69));
  assert.equal(back.settings.fov, 20);
  assert.equal(back.settings.stretch, 'log');
  assert.equal(toURL({ type: 'name', name: "Barnard's Star" }, DEFAULT_SETTINGS), "?q=Barnard%27s+Star");
  assert.equal(fromURL('?q=R%20Dra').query.name, 'R Dra');
  const junk = fromURL('?fov=999&stretch=evil&band=9&q=%3Cb%3E');
  assert.deepEqual(junk.settings, DEFAULT_SETTINGS);
  assert.equal(junk.query, null);
  assert.equal(validSetting('max', '0'), 0);
  assert.equal(fromURL('').query, null);
});

test('state: search -> plan -> frames -> done', () => {
  let s = reducer(initialState, { type: 'SEARCH', query: { type: 'name', name: 'x' } });
  assert.equal(s.status, 'resolving');
  const id = s.requestId;
  s = reducer(s, { type: 'RESOLVED', requestId: id, target: { ra: 1, dec: 2 } });
  assert.equal(s.status, 'listing');
  s = reducer(s, { type: 'PLANNED', requestId: id, plan: { total: 5, planned: 3 } });
  assert.equal(s.status, 'loading');
  s = reducer(s, { type: 'FRAME', requestId: id, frame: { mjd: 3 } });
  s = reducer(s, { type: 'FRAME', requestId: id, frame: { mjd: 1 } });
  assert.deepEqual(s.frames.map(f => f.mjd), [1, 3]);
  assert.equal(s.frames[s.index].mjd, 3, 'keeps showing the same frame when earlier ones arrive');
  s = reducer(s, { type: 'FRAME_FAILED', requestId: id });
  s = reducer(s, { type: 'DONE', requestId: id });
  assert.equal(s.status, 'ready');
  assert.equal(s.failed, 1);
});

test('state: stale results from an older search are ignored', () => {
  let s = reducer(initialState, { type: 'SEARCH', query: { type: 'coords', ra: 1, dec: 1 } });
  const old = s.requestId;
  s = reducer(s, { type: 'SEARCH', query: { type: 'coords', ra: 2, dec: 2 } });
  const after = reducer(s, { type: 'FRAME', requestId: old, frame: { mjd: 1 } });
  assert.equal(after, s);
});

test('state: empty, error, not found, stepping', () => {
  let s = reducer(initialState, { type: 'SEARCH', query: { type: 'coords', ra: 1, dec: 1 } });
  assert.equal(s.status, 'listing');
  assert.equal(reducer(s, { type: 'PLANNED', plan: { total: 0, planned: 0 } }).status, 'empty');
  const e = reducer(s, { type: 'DONE' });
  assert.equal(e.status, 'error');
  assert.equal(e.error.retryable, true);
  const nf = reducer(s, { type: 'NOT_FOUND', message: 'no' });
  assert.equal(nf.error.retryable, false);
  let p = { ...s, index: 0 };
  p = reducer(p, { type: 'STEP', delta: -1, count: 5 });
  assert.equal(p.index, 4);
  p = reducer(p, { type: 'STEP', delta: 1, count: 5 });
  assert.equal(p.index, 0);
  const store = createStore();
  let calls = 0;
  store.subscribe(() => calls++);
  store.dispatch({ type: 'PLAY' });
  store.dispatch({ type: 'NOPE' });
  assert.equal(calls, 1);
  assert.equal(store.get().playing, true);
});

test('planning helpers', () => {
  assert.deepEqual(spread([1, 2, 3, 4, 5, 6, 7, 8, 9], 3), [1, 5, 9]);
  assert.deepEqual(spread([1, 2], 5), [1, 2]);
  assert.deepEqual(spread([1, 2, 3], 0), [1, 2, 3]);
  assert.ok(cutoutSizeDeg(10) > 10 / 60 * Math.SQRT2 && cutoutSizeDeg(10) <= 0.5);
  assert.equal(cutoutSizeDeg(20), 0.4765);
  const t = { ra: 269.452077, dec: 4.693365, pmra: -801.551, pmdec: 10362.394, epoch: 2000 };
  assert.deepEqual(cutoutCenter(t, 61000), cutoutCenter(t, 61000));
  assert.deepEqual(cutoutCenter({ ra: 10.123456789, dec: 5, pmra: 0, pmdec: 0 }, 61000), { ra: 10.12346, dec: 5 });
  const ss = seasons([{ mjd: 1 }, { mjd: 5 }, { mjd: 200 }, { mjd: 230 }, { mjd: 400 }]);
  assert.deepEqual(ss.map(s => s.frames.length), [2, 2, 1]);
  const f = (mjd, v) => ({ mjd, n: 1, data: Float32Array.of(v), detector: 1, expected: [0, 0] });
  const st = buildStacks([f(1, 1), f(2, 3), f(3, 2), f(300, 7)]);
  assert.equal(st.length, 2);
  assert.equal(st[0].data[0], 2);
  assert.equal(st[0].count, 3);
});

test('presets cover NASA targets and aliases', () => {
  assert.equal(PRESETS.length, 5);
  assert.equal(findPreset("barnard's star").key, 'barnard');
  assert.equal(findPreset('Barnard’s Star').key, 'barnard');
  assert.equal(findPreset('R Dra').key, 'r-dra');
  assert.equal(findPreset('eps ind b').key, 'eps-indi-b');
  assert.equal(findPreset('Sirius'), null);
});

test('name lookup: presets offline, SIMBAD failure and not-found are friendly', async () => {
  const t = await resolveTarget({ type: 'name', name: 'wise 0855' }, { fetchFn: () => { throw new Error('offline'); } });
  assert.equal(t.presetKey, 'wise-0855');
  await assert.rejects(resolveTarget({ type: 'name', name: 'Sirius' }, { fetchFn: async () => { throw new TypeError('fetch failed'); } }), /SIMBAD/);
  await assert.rejects(resolveTarget({ type: 'name', name: 'Nope' }, { fetchFn: async () => new Response('main_id,ra,dec,pmra,pmdec,plx_value,otype\n') }), /No star called/);
});

test('pipeline: coordinates with no SPHEREx coverage end as empty', async () => {
  const events = [];
  await run({ type: 'coords', ra: 10, dec: 10 }, DEFAULT_SETTINGS, {
    base: 'http://x', fetchFn: async () => new Response('uri,time_bounds_lower,time_bounds_upper,energy_bandpassname,energy_bounds_lower,energy_bounds_upper,obsid,quality_flag\n'),
    emit: (e) => events.push(e.type),
  });
  assert.deepEqual(events, ['RESOLVED', 'PLANNED']);
  let st = reducer(initialState, { type: 'SEARCH', query: { type: 'coords', ra: 10, dec: 10 } });
  st = reducer(st, { type: 'PLANNED', plan: { total: 0, planned: 0 } });
  assert.equal(st.status, 'empty');
});

test('pipeline: IRSA down gives a retryable error', async () => {
  const events = [];
  await run({ type: 'coords', ra: 10, dec: 10 }, DEFAULT_SETTINGS, { base: 'http://x', fetchFn: async () => new Response('busy', { status: 503 }), emit: (e) => events.push(e) });
  assert.equal(events.at(-1).type, 'ERROR');
  assert.equal(events.at(-1).retryable, true);
});

test('display: stretch and hole filling', () => {
  const d = Float32Array.from([0, 1, 2, 3, NaN, 100]);
  const lin = stretchToBytes(d, 'linear', 0, 100);
  assert.equal(lin[0], 0); assert.equal(lin[5], 255); assert.equal(lin[4], 0);
  const as = stretchToBytes(d, 'asinh', 0, 100);
  assert.ok(as[1] > lin[1], 'asinh lifts faint values');
  const filled = fillHoles(Float32Array.from([1, NaN, 3, 4]), 2);
  assert.equal(filled[1], 4);
});
