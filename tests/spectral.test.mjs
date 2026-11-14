// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Spectral Explorer logic: image picking, aperture photometry, solid angle, chart helpers, CSV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  spreadPick, pickImages, median, aperturePhotometry, whyNoPhotometry, pixelSolidAngle, toMilliJy, apertureFlagged, niceTicks, logTicks, yRange, fmtValue, pointsToCSV,
} from '../web/app/spectral/logic.js';
import { TanSip } from '../web/core/wcs.js';

test('spreadPick keeps the ends and the count', () => {
  const a = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(spreadPick(a, 3), [0, 5, 9]);
  assert.deepEqual(spreadPick(a, 20), a);
  assert.deepEqual(spreadPick(a, 1), [5]);
});

test('pickImages: per detector, interleaved, skips done ones', () => {
  const ims = [];
  for (let d = 1; d <= 6; d++) for (let k = 0; k < 10; k++) ims.push({ uri: `u${d}_${k}`, detector: d, mjdStart: 60000 + k });
  const p = pickImages(ims, 3);
  assert.equal(p.length, 18);
  assert.deepEqual(p.slice(0, 6).map(i => i.detector), [1, 2, 3, 4, 5, 6]);
  const q = pickImages(ims, 3, { skip: new Set(p.map(i => i.uri)) });
  assert.equal(q.length, 18);
  assert.ok(q.every(i => !p.includes(i)));
});

const flat = (nx, ny, v) => ({ nx, ny, data: new Float32Array(nx * ny).fill(v) });

test('aperture photometry: point source on a flat background', () => {
  const img = flat(17, 17, 2);
  img.data[8 * 17 + 8] += 100; img.data[8 * 17 + 9] += 20;
  const r = aperturePhotometry(img, 8, 8, { rAp: 2, rIn: 4, rOut: 7 });
  assert.equal(r.nAp, 13); // pixel centres within 2 px
  assert.ok(Math.abs(r.net - 120) < 1e-4);
  assert.equal(r.bg, 2);
  assert.equal(r.bgSigma, 0);
  assert.equal(r.partial, false);
});

test('aperture photometry: masked pixels scaled, too many masked or off the edge -> null', () => {
  const img = flat(17, 17, 1);
  for (let j = 6; j <= 10; j++) for (let i = 6; i <= 10; i++) img.data[j * 17 + i] = 3; // aperture 2 above bg
  img.data[8 * 17 + 7] = NaN;
  const r = aperturePhotometry(img, 8, 8, { rAp: 2, rIn: 4, rOut: 7 });
  assert.equal(r.nApValid, 12); assert.equal(r.partial, true);
  assert.ok(Math.abs(r.net - 26) < 1e-4); // 12 * 2, scaled by 13/12
  const bad = flat(17, 17, 1);
  for (let j = 6; j <= 10; j++) for (let i = 6; i <= 10; i++) bad.data[j * 17 + i] = NaN;
  assert.equal(aperturePhotometry(bad, 8, 8), null);
  assert.equal(aperturePhotometry(img, -3, 8), null);
  assert.equal(aperturePhotometry(img, 8, 30), null);
  assert.equal(whyNoPhotometry(bad, 8, 8), 'masked'); // saturated core: no data
  assert.equal(whyNoPhotometry(img, -3, 8), 'edge');
  assert.equal(whyNoPhotometry(img, 8, 8), null);
});

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(median([])));
});

test('pixel solid angle and mJy conversion', () => {
  const h = { CTYPE1: 'RA---TAN-SIP', CTYPE2: 'DEC--TAN-SIP', CRPIX1: 9, CRPIX2: 9, CRVAL1: 269.446, CRVAL2: 4.768,
    CD1_1: -6.15 / 3600, CD1_2: 0, CD2_1: 0, CD2_2: 6.15 / 3600, A_ORDER: 0, B_ORDER: 0 };
  const sr = pixelSolidAngle(new TanSip(h), 8, 8);
  const expect = (6.15 / 206264.806) ** 2;
  assert.ok(Math.abs(sr / expect - 1) < 1e-3, `${sr} vs ${expect}`);
  assert.ok(Math.abs(toMilliJy(1, expect) - 0.889) < 0.001); // 1 MJy/sr over one 6.15" pixel ~ 0.89 mJy
});

test('flags inside the aperture only', () => {
  const flagNames = { 1: { name: 'TRANSIENT' }, 8: { name: 'SOURCE' }, 2: { name: 'OVERFLOW' } };
  const flags = new Int32Array(10); flags[3] = 8; flags[4] = 2; flags[9] = 1;
  assert.deepEqual(apertureFlagged(flags, flagNames, [3]), { flagged: false, kinds: [] });
  assert.deepEqual(apertureFlagged(flags, flagNames, [3, 4]), { flagged: true, kinds: ['overflow'] });
  assert.deepEqual(apertureFlagged(null, flagNames, [4]), { flagged: false, kinds: [] });
});

test('chart helpers', () => {
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(logTicks(3, 300), [5, 10, 20, 50, 100, 200]);
  const r = yRange([10, 20]); assert.ok(r.lo <= 0 && r.hi > 20);
  const l = yRange([-1, 10, 100], true); assert.ok(l.lo > 0 && l.lo < 10 && l.hi > 100);
  assert.equal(fmtValue(NaN), '—');
  assert.equal(fmtValue(1234), '1234');
  assert.equal(fmtValue(2e6), '2.00e+6');
});

test('points CSV', () => {
  const csv = pointsToCSV([{ iso: '2025-08-15T20:50:26Z', mjd: 60902.868, season: 0, detector: 6, um: 4.93, bw: 0.04, band: 'Brown Dwarfs', mJy: 123.4, errMJy: 1.2,
    net: 138.8, bg: 0.5, nAp: 13, nApValid: 13, flagged: true, kinds: ['overflow'], obsid: 'x', irsaUrl: 'https://irsa.ipac.caltech.edu/a.fits' }], [{ label: 'Aug 2025' }]);
  const [h, l] = csv.trim().split('\r\n');
  assert.match(h, /^date_utc,mjd,season,detector,wavelength_um/);
  assert.match(l, /Aug 2025,6,4\.9300,0\.0400,Brown Dwarfs,123\.40,1\.20/);
  assert.match(l, /,yes,overflow,x,https:/);
});
