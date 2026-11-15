// The dashed "where it should be" ring on coordinate patches (Nithil's bug, Sun 15 Nov 2026):
// a patch clicked ~65″ south of Barnard's Star drew the ring on empty sky at the patch centre.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringObject, ringAt } from '../web/app/ringobj.js';
import { PRESETS } from '../web/app/presets.js';
import { makeGrid } from '../web/core/align.js';
import { propagate } from '../web/core/motion.js';

const barnard = PRESETS.find(p => /Barnard/.test(p.label));
const MJD = 61116.683136; // 17 Mar 2026 16:24 UTC, the image in Nithil's screenshot
const patchSouthOfBarnard = () => { const b = propagate(barnard.target, MJD); return { ra: b.ra, dec: b.dec - 65 / 3600 }; };

test('a patch just south of Barnard\'s Star rings Barnard\'s Star, not the empty patch centre', () => {
  const c = patchSouthOfBarnard(), grid = makeGrid(c.ra, c.dec, 150);
  const obj = ringObject({ ...c, pmra: 0, pmdec: 0, source: 'coordinates' }, grid, MJD, PRESETS);
  assert.equal(obj?.name, barnard.label);
  const [x, y] = ringAt(grid, obj, MJD);
  assert.ok(Math.abs(x - grid.c) < 1, `x ${x}`);
  assert.ok(Math.abs(grid.c - y - 65 / 6.15) < 0.5, `ring ${grid.c - y} px north of centre, star is ${65 / 6.15}`); // north = up = smaller y
});

test('the ring is hidden on images where the star is off the patch', () => {
  const c = patchSouthOfBarnard(), grid = makeGrid(c.ra, c.dec, 150);
  const obj = ringObject({ ...c, source: 'coordinates' }, grid, MJD, PRESETS);
  assert.equal(ringAt(grid, obj, MJD + 365.25 * 3), null); // 3 years later Barnard's Star is ~31″ further north: off the top edge
});

test('a patch with no catalogued demo star gets no ring', () => {
  const grid = makeGrid(10, 10, 150);
  assert.equal(ringObject({ ra: 10, dec: 10, source: 'coordinates' }, grid, MJD, PRESETS), null);
});

test('a named target keeps its own ring', () => {
  const grid = makeGrid(barnard.target.ra, barnard.target.dec, 150);
  assert.deepEqual(ringObject({ ...barnard.target, presetKey: barnard.key }, grid, MJD, PRESETS), { name: null, own: true });
});
