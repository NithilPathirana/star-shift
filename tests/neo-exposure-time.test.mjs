// The Asteroid page asks JPL about SPHEREx's own exposure time, not 12:00 UTC (neo/sb-ident.js exposureForDate).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSbIdentParams, exposureForDate, mjdToJplTime, timeLapseHref } from '../web/app/neo/sb-ident.js';

// IRSA SIA rows for the example field (RA 0.5622, Dec -1.0231), as listImagesSIA returns them (two detectors per exposure).
const im = (obsid, mjdStart, mjdEnd, detectors) => detectors.map(detector => ({ obsid, mjdStart, mjdEnd, detector }));
const DEC_14 = [
  ...im('2025W50_2A_0577_4', 61022.67535, 61022.676686, [5, 2]),          // 13 Dec, another day
  ...im('2025W50_2A_0717_1', 61023.353331, 61023.354664, [6, 3]),         // 14 Dec 08:28:47
  ...im('2025W50_2A_0717_2', 61023.354823, 61023.356156, [6, 3]),
  ...im('2025W50_2A_0717_3', 61023.356316, 61023.357648, [3, 6]),
  ...im('2025W50_2A_0717_4', 61023.357808, 61023.359140, [6, 3]),         // ends 08:37:09
  ...im('2025W51_1A_0022_1', 61024.097487, 61024.098819, [4, 1]),         // 15 Dec, another day
];
// 15 Jun 2026: three visits (2, 4 and 3 exposures)
const JUN_15 = [
  ...im('2026W25_1A_0030_1', 61206.149011, 61206.150343, [4, 1]),
  ...im('2026W25_1A_0030_2', 61206.150504, 61206.151836, [4, 1]),
  ...im('2026W25_1A_0054_1', 61206.284149, 61206.285481, [4, 1]),
  ...im('2026W25_1A_0054_2', 61206.285659, 61206.286991, [1, 4]),
  ...im('2026W25_1A_0054_3', 61206.287151, 61206.288483, [4, 1]),
  ...im('2026W25_1A_0054_4', 61206.288644, 61206.289976, [4, 1]),
  ...im('2026W25_1A_0153_1', 61206.825145, 61206.826477, [4]),
  ...im('2026W25_1A_0153_2', 61206.826637, 61206.827969, [4, 1]),
  ...im('2026W25_1A_0153_3', 61206.828129, 61206.829461, [4, 1]),
];

test('14 Dec 2025: JPL is asked at the middle exposure of the 08:28-08:37 visit, not 12:00', () => {
  const t = exposureForDate(DEC_14, '2025-12-14');
  assert.equal(t.covered, true);
  assert.equal(t.visits, 1);
  assert.equal(t.visit.exposures, 4);
  assert.equal(t.exposure, '2025W50_2A_0717_2');
  assert.deepEqual(t.detectors, [3, 6]);
  assert.equal(t.detector, 3);
  assert.equal(t.mjdStart, 61023.354823);
  assert.match(t.obsTime, /^2025-12-14_08:3[0-4]:\d\d$/);
  assert.ok(Math.abs(t.mjd - 61023.3555) < 0.002); // ~08:32 UTC
  const p = buildSbIdentParams({ ra: 0.5622, dec: -1.0231, fov: 0.5, date: '2025-12-14', kind: 'a', obsTime: t.obsTime });
  assert.equal(p.get('obs-time'), t.obsTime);
});

test('a day with several visits uses the one with the most exposures', () => {
  const t = exposureForDate(JUN_15, '2026-06-15');
  assert.equal(t.visits, 3);
  assert.equal(t.visit.exposures, 4);
  assert.match(t.exposure, /^2026W25_1A_0054_[23]$/);
  assert.match(t.obsTime, /^2026-06-15_06:5\d:\d\d$/);
});

test('equal visits: the one nearest 12:00 UTC wins', () => {
  const imgs = [...im('A_1', 61206.10, 61206.101, [1]), ...im('B_1', 61206.55, 61206.551, [2]), ...im('C_1', 61206.90, 61206.901, [3])];
  assert.equal(exposureForDate(imgs, '2026-06-15').exposure, 'B_1');
});

test('no SPHEREx image that day: 12:00 UTC, marked not covered', () => {
  const t = exposureForDate(DEC_14, '2026-06-15');
  assert.equal(t.covered, false);
  assert.equal(t.obsTime, '2026-06-15_12:00:00');
  assert.equal(exposureForDate(null, '2025-12-14').covered, false);
  assert.equal(buildSbIdentParams({ ra: 1, dec: 1, fov: 0.5, date: '2026-06-15', kind: 'a' }).get('obs-time'), '2026-06-15_12:00:00');
});

test('obs-time format and validation', () => {
  assert.equal(mjdToJplTime(61023.5), '2025-12-14_12:00:00');
  assert.throws(() => buildSbIdentParams({ ra: 1, dec: 1, fov: 0.5, date: '2025-12-14', kind: 'a', obsTime: '2025-12-15_08:00:00' }), TypeError);
});

test('Show in time-lapse: centred on the exposure-time place, opening on that exposure and detector', () => {
  const t = exposureForDate(DEC_14, '2025-12-14');
  const url = new URL(timeLapseHref(0.54396, -1.03513, t), 'http://x/');
  assert.equal(url.searchParams.get('ra'), '0.543960');
  assert.equal(url.searchParams.get('dec'), '-1.035130');
  assert.equal(url.searchParams.get('scene'), 'viewer');
  assert.equal(url.searchParams.get('mjd'), '61023.35482');
  assert.equal(url.searchParams.get('det'), '3');
  const noon = new URL(timeLapseHref(10, 2, exposureForDate([], '2025-12-14')), 'http://x/');
  assert.equal(noon.searchParams.get('mjd'), null);
});
