// Gaia overlay on the viewer's frames (judging panel b9): stars moved from Gaia's 2016.0 epoch to the
// image's date, placed on the viewer grid, brightest 40 only.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gaiaMarks, GAIA_OVERLAY_MAX, DEMO_CONES } from '../web/app/gaia-overlay.js';
import { gaiaCone } from '../web/core/resolve.js';
import { PRESETS } from '../web/app/presets.js';
import { makeGrid, worldToGrid } from '../web/core/align.js';
import { propagate, epochYearToMjd, separationArcsec } from '../web/core/motion.js';

const grid = makeGrid(180, 0, 150); // 25 × 25 px of 6.15″
const wide = makeGrid(180, 0, 300); // 49 × 49 px

test('a star is moved from 2016.0 to the image date: 10″/yr north for 10 years = 100″ up the image', () => {
  const star = { id: 'x', ra: 180, dec: 0, pmra: 0, pmdec: 10000, g: 10, epoch: 2016.0 };
  const [at2016] = gaiaMarks([star], wide, epochYearToMjd(2016.0));
  const [at2026] = gaiaMarks([star], wide, epochYearToMjd(2026.0));
  assert.ok(Math.abs(at2016.x - wide.c) < 1e-6 && Math.abs(at2016.y - wide.c) < 1e-6);
  assert.ok(Math.abs(at2026.x - wide.c) < 1e-3);
  assert.ok(Math.abs((at2016.y - at2026.y) - 100 / 6.15) < 0.01, 'north is up: y gets smaller');
  // east (positive pmra) is left on the sky view
  const [east] = gaiaMarks([{ ...star, pmra: 6150, pmdec: 0 }], grid, epochYearToMjd(2017.0));
  assert.ok(Math.abs((grid.c - east.x) - 1) < 0.01 && Math.abs(east.y - grid.c) < 1e-3);
});

test('only the brightest 40 inside the image are kept; too faint and off-image stars are dropped', () => {
  const stars = [];
  for (let i = 0; i < 60; i++) stars.push({ id: 'in' + i, ra: 180 + (i % 10 - 5) * 0.002, dec: (Math.floor(i / 10) - 3) * 0.002, g: 18 - i * 0.01, epoch: 2016 });
  stars.push({ id: 'faint', ra: 180, dec: 0, g: 20.5, epoch: 2016 }, { id: 'off', ra: 180.2, dec: 0, g: 5, epoch: 2016 });
  const m = gaiaMarks(stars, grid, epochYearToMjd(2025.5));
  assert.equal(m.length, GAIA_OVERLAY_MAX);
  assert.ok(!m.some(s => s.id === 'faint' || s.id === 'off'));
  for (let i = 1; i < m.length; i++) assert.ok(m[i].g >= m[i - 1].g, 'brightest first');
  assert.deepEqual(gaiaMarks(stars, null, 61000), []);
});

test('WISE 0855: the G 16.3 background star is circled about 7.8″ from the brown dwarf (saved demo cone)', async () => {
  const csv = readFileSync(new URL('../web/prebaked/wise-0855/8bd59c81382079d7.csv', import.meta.url), 'utf8');
  const [ra0, dec0] = DEMO_CONES['wise-0855'];
  const rows = await gaiaCone(ra0, dec0, 260, { endpoint: 'http://x/gaia/tap/sync', top: 1000, fetchFn: async () => ({ ok: true, text: async () => csv }) });
  // it moves ~8″/yr past the star: 10.6″ apart in mid-2025, 7.8″ by late 2025 (spot/logic.js)
  const mjd = epochYearToMjd(2025.87), w = propagate(PRESETS.find(p => p.key === 'wise-0855').target, mjd);
  const g = makeGrid(w.ra, w.dec, 150), [wx, wy] = worldToGrid(g, w.ra, w.dec);
  const near = gaiaMarks(rows, g, mjd).map(m => ({ ...m, sep: Math.hypot(m.x - wx, m.y - wy) * 6.15 })).sort((a, b) => a.sep - b.sep)[0];
  assert.ok(Math.abs(near.g - 16.3) < 0.1, `nearest circle is G ${near.g}`);
  assert.ok(Math.abs(near.sep - 7.8) < 0.5, `nearest circle is ${near.sep.toFixed(2)}″ away`);
  assert.ok(separationArcsec(ra0, dec0, w.ra, w.dec) < 100, 'demo cone covers the field');
});
