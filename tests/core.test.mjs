// Offline tests for the data core, checked against Astropy reference values.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scanHDUs, parseValue, readHDUsFromStream } from '../web/core/fits.js';
import { decodeCutout, parseCSV, cutoutUrl, mapLimit } from '../web/core/irsa.js';
import { TanSip, tanProject, tanDeproject } from '../web/core/wcs.js';
import { propagate, separationArcsec, parseAngle, mjdToDate, epochYearToMjd } from '../web/core/motion.js';
import { wavelengthAt } from '../web/core/wave.js';
import { makeGrid, reproject, centroid, worldToGrid, gridToWorld, fitLine } from '../web/core/align.js';

const fx = (p) => new URL('./fixtures/' + p, import.meta.url);
const ref = JSON.parse(readFileSync(fx('astropy_ref.json'), 'utf8'));
const bytes = new Uint8Array(readFileSync(fx('cutout_3hdu.fits')));

test('FITS header values parse', () => {
  assert.equal(parseValue(" 'SPHEREx-D2'  / band"), 'SPHEREx-D2');
  assert.equal(parseValue(" 'it''s'"), "it's");
  assert.equal(parseValue('   -591.5 / x'), -591.5);
  assert.equal(parseValue('  1.5D-03'), 0.0015);
  assert.equal(parseValue('  T'), true);
});

test('cutout decodes and pixels match Astropy', () => {
  const c = decodeCutout(bytes);
  assert.deepEqual([c.image.ny, c.image.nx], ref.image_shape);
  for (const [k, v] of Object.entries(ref.image_samples)) {
    const [y, x] = k.split(',').map(Number);
    assert.ok(Math.abs(c.image.data[y * c.image.nx + x] - v) <= Math.abs(v) * 1e-6 + 1e-9, k);
  }
  for (const [k, v] of Object.entries(ref.flags_samples)) {
    const [y, x] = k.split(',').map(Number);
    assert.equal(c.flags.data[y * c.flags.nx + x], v);
  }
  assert.equal(c.mjd, ref.mjd_avg);
  assert.equal(c.detector, Number(ref.detector));
});

test('partial buffers: scan waits for complete HDUs', () => {
  assert.equal(scanHDUs(bytes.slice(0, 5000), 3).done, false);
  assert.equal(scanHDUs(bytes, 3).done, true);
  assert.equal(scanHDUs(bytes, 3).bytesUsed, bytes.length);
});

test('stream reader stops after N HDUs even with tiny chunks and extra trailing data', async () => {
  const extra = new Uint8Array(bytes.length + 100000);
  extra.set(bytes);
  let pulled = 0;
  const stream = new ReadableStream({
    pull(ctrl) {
      if (pulled >= extra.length) return ctrl.close();
      ctrl.enqueue(extra.slice(pulled, pulled + 997));
      pulled += 997;
    },
  });
  const out = await readHDUsFromStream(stream, 3);
  assert.equal(out.length, bytes.length);
  assert.ok(pulled < bytes.length + 2000, 'stopped reading early');
});

test('TAN-SIP pixel->world matches Astropy to < 1 mas', () => {
  const c = decodeCutout(bytes);
  ref.pix.forEach(([x, y], k) => {
    const [ra, dec] = c.wcs.pixToWorld(x, y);
    const sep = separationArcsec(ra, dec, ref.world[k][0], ref.world[k][1]);
    assert.ok(sep < 0.001, `pix ${x},${y}: ${sep}"`);
  });
});

test('TAN-SIP world->pixel matches Astropy to < 0.001 px', () => {
  const c = decodeCutout(bytes);
  ref.world.forEach(([ra, dec], k) => {
    const [x, y] = c.wcs.worldToPix(ra, dec);
    assert.ok(Math.hypot(x - ref.pix[k][0], y - ref.pix[k][1]) < 1e-3, `world ${k}`);
  });
  assert.ok(Math.abs(c.wcs.scaleArcsec - 6.15) < 0.1);
});

test('gnomonic projection round-trips (incl. near the pole and RA wrap)', () => {
  for (const [ra0, dec0, ra, dec] of [[10, 20, 10.01, 20.02], [359.99, 0, 0.01, 0.01], [45, 89.9, 225, 89.95]]) {
    const [xi, eta] = tanProject(ra, dec, ra0, dec0);
    const [r2, d2] = tanDeproject(xi, eta, ra0, dec0);
    assert.ok(separationArcsec(ra, dec, r2, d2) < 1e-6);
  }
});

test('wavelength lookup matches Astropy -TAB', () => {
  const c = decodeCutout(bytes);
  ref.pix.slice(0, 15).forEach(([x, y], k) => {
    const { wavelength } = wavelengthAt(c.header, ref.wcs_wave, x, y);
    assert.ok(Math.abs(wavelength - ref.wavelength_um[k]) < 1e-4, `${x},${y}: ${wavelength} vs ${ref.wavelength_um[k]}`);
  });
});

test("Barnard's Star propagation matches Astropy to < 5 mas", () => {
  const s = { ...ref.barnard.star, epoch: 2000.0 };
  for (const p of ref.barnard.propagated) {
    const q = propagate(s, p.mjd);
    const sep = separationArcsec(q.ra, q.dec, p.ra, p.dec);
    assert.ok(sep < 0.005, `mjd ${p.mjd}: ${sep}"`);
  }
  // ~10.39"/yr total motion
  const a = propagate(s, epochYearToMjd(2025)), b = propagate(s, epochYearToMjd(2026));
  assert.ok(Math.abs(separationArcsec(a.ra, a.dec, b.ra, b.dec) - 10.393) < 0.01);
});

test('angle parsing (NASA WISE 0855 coordinates)', () => {
  assert.ok(Math.abs(parseAngle('08h55m10.831s', true) - 133.79513) < 1e-5);
  assert.ok(Math.abs(parseAngle('-7d14m42.53s', false) + 7.245147) < 1e-5);
  assert.equal(parseAngle('269.4461', true), 269.4461);
  assert.ok(Math.abs(parseAngle('-00 30 00', false) + 0.5) < 1e-12);
  assert.throws(() => parseAngle('abc', true));
});

test('MJD to calendar date', () => {
  assert.equal(mjdToDate(60902.5).toISOString().slice(0, 10), '2025-08-15');
});

test('CSV parser handles quotes and commas', () => {
  const rows = parseCSV('a,b\n"x, ""y""",2\r\nz,3\n');
  assert.deepEqual(rows, [{ a: 'x, "y"', b: '2' }, { a: 'z', b: '3' }]);
});

test('cutout URLs only for SPHEREx archive paths', () => {
  assert.match(cutoutUrl('ibe/data/spherex/dr1/a/b.fits', 1, 2, 0.05), /center=1\.000000,2\.000000d&size=0\.05$/);
  assert.throws(() => cutoutUrl('../../etc/passwd', 1, 2, 0.05));
  assert.throws(() => cutoutUrl('ibe/data/spherex/x.fits?evil=1', 1, 2, 0.05));
});

test('reprojection keeps a star at its sky position (synthetic rotated WCS)', () => {
  // Fake 41x41 cutout, rotated 30°, flipped like SPHEREx, with a Gaussian star.
  const th = (30 * Math.PI) / 180, s = 6.15 / 3600;
  const header = {
    CTYPE1: 'RA---TAN-SIP', CTYPE2: 'DEC--TAN-SIP', CRPIX1: 21, CRPIX2: 21, CRVAL1: 150, CRVAL2: -30,
    PC1_1: s * Math.cos(th), PC1_2: -s * Math.sin(th), PC2_1: -s * Math.sin(th), PC2_2: -s * Math.cos(th),
  };
  const wcs = new TanSip(header);
  const starRa = 150.004, starDec = -29.997;
  const [sx, sy] = wcs.worldToPix(starRa, starDec);
  const nx = 41, data = new Float32Array(nx * nx);
  for (let y = 0; y < nx; y++) for (let x = 0; x < nx; x++)
    data[y * nx + x] = 5 + 1000 * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * 1.2 ** 2));
  const cut = { wcs, image: { nx, ny: nx, data }, flags: null };
  const grid = makeGrid(150, -30, 150);
  const frame = reproject(cut, grid);
  const [gx, gy] = worldToGrid(grid, starRa, starDec);
  const c = centroid(frame, Math.round(gx), Math.round(gy));
  assert.ok(Math.hypot(c.x - gx, c.y - gy) < 0.1, `off by ${Math.hypot(c.x - gx, c.y - gy)} px`);
  // north up / east left: a star north-east of centre is up-left
  assert.ok(gx < grid.c && gy < grid.c);
  const [r, d] = gridToWorld(grid, gx, gy);
  assert.ok(separationArcsec(r, d, starRa, starDec) < 1e-6);
});

test('line fit recovers slope', () => {
  const f = fitLine([0, 1, 2, 3], [1, 3, 5, 7]);
  assert.ok(Math.abs(f.b - 2) < 1e-12 && Math.abs(f.a - 1) < 1e-12);
});

test('mapLimit keeps order and survives failures', async () => {
  let live = 0, maxLive = 0;
  const r = await mapLimit([1, 2, 3, 4, 5], 2, async (v) => {
    live++; maxLive = Math.max(maxLive, live);
    await new Promise(res => setTimeout(res, 5)); live--;
    if (v === 3) throw new Error('boom');
    return v * 10;
  });
  assert.equal(maxLive, 2);
  assert.deepEqual(r.map(x => x.ok ? x.value : 'err'), [10, 20, 'err', 40, 50]);
});

test('fetchCutout retries on 503 then succeeds; gives up on 404', async () => {
  const { fetchCutout } = await import('../web/core/irsa.js');
  let calls = 0;
  const flaky = async () => (++calls < 3 ? new Response('busy', { status: 503 }) : new Response(bytes));
  const c = await fetchCutout('ibe/data/spherex/dr1/a.fits', 1, 2, 0.05, { fetchFn: flaky, backoffMs: 1 });
  assert.equal(calls, 3);
  assert.equal(c.image.nx, 29);
  const gone = async () => new Response('no', { status: 404 });
  await assert.rejects(fetchCutout('ibe/data/spherex/dr1/a.fits', 1, 2, 0.05, { fetchFn: gone, backoffMs: 1 }), /404/);
});
