// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Tests for contamination flags (feature B): kind masks, counts, airglow, the frame filter,
// HIERARCH header cards, and the relay's separate 5-HDU cutout variant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kindMasks, pixelKinds, countKinds, airglowOf, visibleFrames, frameHas, layerRange, flagNamesOf } from '../web/core/contam.js';
import { parseHeader } from '../web/core/fits.js';
import { handle } from '../proxy/worker.js';
import { fetchCutoutLayers } from '../web/core/irsa.js';

// Same bit layout as a real SPHEREx FLAGS header (read from MSKN/MSKM cards at run time in the app).
const NAMES = { 1: 'TRANSIENT', 2: 'OVERFLOW', 64: 'NONFUNC', 2097152: 'SOURCE', 4096: 'FULLSAMPLE', 4194304: 'GHOST', 8388608: 'GHOST_FPA',
  16777216: 'GHOST_EXT', 67108864: 'BLOOM', 134217728: 'SNOWBALL', 268435456: 'HALO' };
const FN = Object.fromEntries(Object.entries(NAMES).map(([b, n]) => [b, { name: n, description: '' }]));

test('kind masks come from the header names; SOURCE/FULLSAMPLE are not contamination', () => {
  const m = kindMasks(FN);
  assert.equal(m.cosmic, 1 | 134217728 | 268435456);
  assert.equal(m.overflow, 2);
  assert.equal(m.scatter, 4194304 | 8388608 | 16777216);
  assert.equal(m.other, 64 | 67108864);
  assert.deepEqual(pixelKinds(2097152 | 4096, m), []);
  assert.deepEqual(pixelKinds(2 | 1 | 64, m), ['cosmic', 'overflow', 'other']);
  assert.deepEqual(flagNamesOf(2097152 | 2, FN), ['OVERFLOW']);
});

test('counts per kind, no-data pixels, and a radius around the star', () => {
  const m = kindMasks(FN);
  const flags = new Int32Array(9); flags[0] = 1; flags[4] = 2; flags[8] = 4194304;
  const data = [1, NaN, 1, 1, 1, 1, 1, 1, 1];
  assert.deepEqual(countKinds(flags, m, data), { cosmic: 1, overflow: 1, scatter: 1, other: 0, nodata: 1, flagged: 4 });
  const near = countKinds(flags, m, data, { n: 3, cx: 1, cy: 1, r: 0.5 });
  assert.deepEqual(near, { cosmic: 0, overflow: 1, scatter: 0, other: 0, nodata: 0, flagged: 1 });
});

test('airglow: header keywords or the 1.083 µm helium line in bands 1-2', () => {
  assert.equal(airglowOf({ HE_AIRGLOW_CONT: 'true', DETECTOR: 2 }, 1.5).flagged, true);
  assert.equal(airglowOf({ HE_AIRGLOW_CONT: 'false', AURORA_CONT: 'false', DETECTOR: 2 }, 1.5).flagged, false);
  assert.equal(airglowOf({ AURORA_CONT: true, DETECTOR: 4 }, 3).flagged, true);
  const he = airglowOf({ HE_AIRGLOW_CONT: 'false', DETECTOR: 1 }, 1.09, 0.025);
  assert.equal(he.nearHe, true); assert.deepEqual(he.reasons, ['near 1.083 µm']);
  assert.equal(airglowOf({ DETECTOR: 3 }, 1.083).nearHe, false); // band 3 cannot see it
  assert.equal(airglowOf({ DETECTOR: 1 }, 0.9).nearHe, false);
});

test('frame filter hides frames that show any chosen kind', () => {
  const F = [{ counts: { cosmic: 2 }, glow: { flagged: false } }, { counts: { cosmic: 0 }, glow: { flagged: true } }, { counts: {}, glow: {} }];
  assert.equal(visibleFrames(F, new Set()).length, 3);
  assert.deepEqual(visibleFrames(F, new Set(['cosmic'])), [F[1], F[2]]);
  assert.deepEqual(visibleFrames(F, new Set(['cosmic', 'airglow'])), [F[2]]);
  assert.equal(frameHas(F[1], 'airglow'), true);
});

test('layer range ignores NaN and nulls', () => {
  const r = layerRange([NaN, null, 1, 2, 3, 4, 5]);
  assert.equal(r.lo, 1); assert.equal(r.hi, 5); assert.equal(r.median, 3);
  assert.equal(layerRange([NaN]), null);
});

test('HIERARCH cards (long keywords like HE_AIRGLOW_CONT) are read', () => {
  const cards = ["HIERARCH HE_AIRGLOW_CONT = 'true    '", 'HIERARCH L2 N_GHOST = 12', 'NAXIS   =                    0', 'END'];
  const bytes = new Uint8Array(2880).fill(32);
  cards.forEach((c, i) => { for (let k = 0; k < c.length; k++) bytes[i * 80 + k] = c.charCodeAt(k); });
  const { header } = parseHeader(bytes, 0);
  assert.equal(header.HE_AIRGLOW_CONT, 'true');
  assert.equal(header['L2 N_GHOST'], 12);
  assert.equal(header.NAXIS, 0);
});

const fixture = new Uint8Array(readFileSync(new URL('./fixtures/cutout_3hdu.fits', import.meta.url)));
function memCache() {
  const m = new Map();
  return { m, match: async (req) => m.get(req.url)?.clone(), put: async (req, res) => { m.set(req.url, res); } };
}

test('relay: hdus=5 is a separate, allow-listed cutout variant with its own cache key', async () => {
  const log = [], cache = memCache();
  const fetchFn = async (url) => { log.push(url); return new Response(fixture, { status: 200 }); };
  const u = 'https://relay.example/ibe/data/spherex/dr1/x/y.fits?center=269.4461,4.7707d&size=0.05';
  const a = await handle(new Request(u), { fetchFn, cache });
  const b = await handle(new Request(u + '&hdus=5'), { fetchFn, cache });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(log.length, 2);
  assert.equal(log[1], log[0]); // same IRSA URL upstream
  assert.deepEqual([...cache.m.keys()], [log[0], log[0] + '&hdus=5']); // default key unchanged
  assert.equal((await handle(new Request(u + '&hdus=7'), { fetchFn, cache })).status, 400);
});

test('fetchCutoutLayers asks the relay for hdus=5 (and never sends it to IRSA directly)', async () => {
  const seen = [];
  const fetchFn = async (url) => { seen.push(url); return new Response('x', { status: 404 }); };
  await assert.rejects(fetchCutoutLayers('ibe/data/spherex/dr1/a.fits', 1, 2, 0.05, { base: 'http://relay', fetchFn, retries: 0 }), /404/);
  await assert.rejects(fetchCutoutLayers('ibe/data/spherex/dr1/a.fits', 1, 2, 0.05, { fetchFn, retries: 0 }), /404/);
  assert.ok(seen[0].endsWith('&hdus=5'));
  assert.ok(!seen[1].includes('hdus'));
});
