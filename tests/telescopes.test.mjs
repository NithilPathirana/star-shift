// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Telescope compare (DESIGN.md 31a): WCS readers, shared field and scale, north-up drawing,
// header dates/sites, SIA picking, and the strict 2MASS/AllWISE relay routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { linearWcs, sinDeproject, fieldFor, skyToScreen, pxPerArcsec, screenPixel, imageAffine, applyAffine, nearestPixel,
  twomassMeta, wiseMeta, positionsAt, yearOf, stretch } from '../web/app/telescopes/geometry.js';
import { pickImages, SURVEYS, cutoutUrl, decodeSurvey } from '../web/app/telescopes/surveys.js';
import { tanDeproject } from '../web/core/wcs.js';
import { separationArcsec, epochYearToMjd } from '../web/core/motion.js';
import { makeGrid, gridToWorld } from '../web/core/align.js';
import { handle } from '../proxy/worker.js';
import { PRESETS } from '../web/app/presets.js';

// Real header values (2MASS Ks atlas 990916n/s028, AllWISE 2688p045_ac51 W1 cutout).
const H2M = { CTYPE1: 'RA---SIN', CTYPE2: 'DEC--SIN', CRPIX1: 90.5, CRPIX2: 91.5, CRVAL1: 352.5807212, CRVAL2: 38.63090625,
  CROTA2: 0.007497595054, CDELT1: -0.0002777777845, CDELT2: 0.0002777777845, ORDATE: '990916', UT_DATE: '990916', UT: '08:21:33.33', TELNAME: 'Hopkins', FILTER: 'k' };
const HW = { CTYPE1: 'RA---SIN', CTYPE2: 'DEC--SIN', CRPIX1: 1649, CRPIX2: -287, CRVAL1: 268.86057, CRVAL2: 4.543333, CROTA2: 0,
  CDELT1: -0.0003819444391411, CDELT2: 0.0003819444391411, DATEOBS1: '2010-03-18T13:11:42.572', DATEOBS2: '2010-09-19T11:33:20.328',
  MIDOBS: '2010-09-14T14:05:49.712', BAND: 1, WAVELEN: 3.368, NUMFRMS: 297 };
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('WCS: pixel scales from the real headers (2MASS 1.0″, AllWISE 1.375″) and the reference pixel lands on CRVAL', () => {
  const w2 = linearWcs(H2M), ww = linearWcs(HW);
  close(w2.scaleArcsec, 1.0, 1e-6); close(ww.scaleArcsec, 1.375, 1e-6);
  const [ra, dec] = w2.pixToWorld(H2M.CRPIX1 - 1, H2M.CRPIX2 - 1);
  close(ra, H2M.CRVAL1, 1e-9); close(dec, H2M.CRVAL2, 1e-9);
  assert.throws(() => linearWcs({ CTYPE1: 'GLON-CAR', CTYPE2: 'GLAT-CAR' }));
});

test('WCS: +1 pixel in y is north and +1 in x is west (east left) for these north-up atlases', () => {
  const w = linearWcs(HW), [r0, d0] = w.pixToWorld(100, 100), [r1, d1] = w.pixToWorld(100, 101), [r2, d2] = w.pixToWorld(101, 100);
  assert.ok(d1 > d0); close(r1, r0, 1e-5); // tiny RA change: meridians converge 0.6° from the tile centre
  assert.ok(r2 < r0); close(d2, d0, 1e-5);
  close(separationArcsec(r0, d0, r1, d1), 1.375, 1e-4);
});

test('SIN and TAN agree to well under a pixel a few arcminutes from the centre', () => {
  const [a, b] = sinDeproject(0.05, 0.03, 120, 30), [c, d] = tanDeproject(0.05, 0.03, 120, 30);
  assert.ok(separationArcsec(a, b, c, d) < 0.05);
});

test('one shared field holds Barnard’s Star from 2MASS (1997–2001) to SPHEREx (2025), with a margin', () => {
  const b = PRESETS.find(p => p.key === 'barnard').target, fixed = { ra: b.ra, dec: b.dec };
  const mjds = [epochYearToMjd(1997.4), epochYearToMjd(2001.3), epochYearToMjd(2010.5), epochYearToMjd(2025.3), epochYearToMjd(2026.2)];
  const pts = positionsAt(b, fixed, mjds), f = fieldFor(pts, { minArcsec: 154 });
  // 10.39″/yr over ~29 years is ~300″ (about 5′): bigger than the SPHEREx cutout (154″)
  const span = separationArcsec(pts[0].ra, pts[0].dec, pts[4].ra, pts[4].dec);
  assert.ok(span > 280 && span < 320, `span ${span}`);
  assert.ok(f.sizeArcsec >= span + 100 && f.sizeArcsec <= span + 120, `size ${f.sizeArcsec}`);
  assert.equal(f.clipped, false);
  for (const p of pts) { const [x, y] = skyToScreen(f, 300, p.ra, p.dec); assert.ok(x > 0 && x < 300 && y > 0 && y < 300); }
  const still = fieldFor([fixed, fixed], { minArcsec: 154 }); assert.equal(still.sizeArcsec, 154);
  assert.equal(fieldFor(pts, { maxArcsec: 200 }).clipped, true);
});

test('screen scale: same arcsec per screen pixel in every panel; each survey keeps its own pixel size', () => {
  const f = { ra0: 269.45, dec0: 4.7, sizeArcsec: 400 };
  close(pxPerArcsec(f, 400), 1, 1e-12);
  close(screenPixel(f, 400, 6.15), 6.15, 1e-12); close(screenPixel(f, 400, 1.375), 1.375, 1e-12); close(screenPixel(f, 400, 1.0), 1.0, 1e-12);
  // 60″ north of the centre is 60 px up; 60″ east is 60 px LEFT
  const [ra, dec] = tanDeproject(0, 60 / 3600, f.ra0, f.dec0), [x, y] = skyToScreen(f, 400, ra, dec);
  close(x, 200, 1e-6); close(y, 140, 1e-6);
  const [ra2, dec2] = tanDeproject(60 / 3600, 0, f.ra0, f.dec0), [x2, y2] = skyToScreen(f, 400, ra2, dec2);
  close(x2, 140, 1e-6); close(y2, 200, 1e-6);
});

test('image affine: an AllWISE pixel maps to where its own WCS says, north up, 1.375 px wide at 1 px/″', () => {
  const w = linearWcs(HW), nx = 210, ny = 210, f = { ra0: 269.452, dec0: 4.693, sizeArcsec: 300 };
  const near = nearestPixel(w, f.ra0, f.dec0, nx, ny), m = imageAffine(w.pixToWorld, nx, ny, f, 300, { flipY: true, near });
  for (const [x, y] of [[near[0], near[1]], [10, 20], [200, 190]]) {
    const V = ny - 1 - y, [sx, sy] = applyAffine(m, x + 0.5, V + 0.5), [ra, dec] = w.pixToWorld(x, y), [ex, ey] = skyToScreen(f, 300, ra, dec);
    close(sx, ex, 0.02, 'x'); close(sy, ey, 0.02, 'y');
  }
  close(Math.hypot(m[0], m[1]), 1.375, 1e-3); close(Math.hypot(m[2], m[3]), 1.375, 1e-3);
  assert.ok(m[3] > 0 && Math.abs(m[2]) < 0.01, 'canvas rows run down the screen (FITS rows flipped); the tile is twisted only ~0.05° from local north here');
  assert.ok(m[0] > 0 && Math.abs(m[1]) < 0.01, 'canvas columns run right (east left on the sky)');
});

test('image affine for the SPHEREx grid (row 0 at the top, no flip)', () => {
  const g = makeGrid(269.452, 4.693, 154, 6.15), f = { ra0: 269.452, dec0: 4.693, sizeArcsec: 308 };
  const m = imageAffine((i, j) => gridToWorld(g, i, j), g.n, g.n, f, 308, { flipY: false });
  const [sx, sy] = applyAffine(m, g.c + 0.5, g.c + 0.5); close(sx, 154, 1e-6); close(sy, 154, 1e-6);
  close(m[0], 6.15, 1e-3); close(m[3], 6.15, 1e-3);
});

test('header dates and sites: 2MASS real UT and telescope, AllWISE first/last/middle frame', () => {
  const t = twomassMeta(H2M);
  assert.equal(t.date, '1999-09-16'); assert.equal(t.site, 'Mt Hopkins, Arizona'); assert.equal(t.hemi, 'north');
  close(t.mjd, 51437.348, 0.001);
  assert.equal(twomassMeta({ ORDATE: '000122', TELNAME: 'CTIO' }).site, 'Cerro Tololo, Chile');
  assert.equal(twomassMeta({}).date, null);
  const w = wiseMeta(HW);
  assert.deepEqual([w.first, w.last, w.mid, w.band, w.frames], ['2010-03-18', '2010-09-19', '2010-09-14', 'W1', 297]);
  assert.equal(yearOf(w.mjd), 2010); assert.equal(yearOf(t.mjd), 1999);
});

test('SIA picking: only exact 2MASS Ks / AllWISE W1 paths, nearest centre first', () => {
  const rows = [
    { access_url: 'https://irsa.ipac.caltech.edu/ibe/data/twomass/allsky/allsky/990916n/s028/image/hi0280150.fits.gz', s_ra: '269.45', s_dec: '4.69' },
    { access_url: 'https://irsa.ipac.caltech.edu/ibe/data/twomass/allsky/allsky/990916n/s028/image/ki0280150.fits.gz', s_ra: '269.40', s_dec: '4.75' },
    { access_url: 'https://irsa.ipac.caltech.edu/ibe/data/twomass/allsky/allsky/990917n/s030/image/ki0300001.fits.gz', s_ra: '269.45', s_dec: '4.70' },
    { access_url: 'https://evil.example/ibe/data/twomass/allsky/allsky/990916n/s028/image/ki0280151.fits.gz', s_ra: '269.45', s_dec: '4.69' },
  ];
  const got = pickImages(rows, SURVEYS.twomass, 269.452, 4.693);
  assert.deepEqual(got.map(g => g.path.split('/').pop()), ['ki0300001.fits.gz', 'ki0280150.fits.gz']);
  const w = pickImages([{ access_url: 'https://irsa.ipac.caltech.edu/ibe/data/wise/allwise/p3am_cdd/26/2688/2688p045_ac51/2688p045_ac51-w1-int-3.fits' },
    { access_url: 'https://irsa.ipac.caltech.edu/ibe/data/wise/allwise/p3am_cdd/26/2688/2688p045_ac51/2688p045_ac51-w1-unc-3.fits.gz' }], SURVEYS.wise, 269.452, 4.693);
  assert.equal(w.length, 1);
  assert.equal(pickImages([], SURVEYS.wise, 0, 0).length, 0); // -> "No image of this patch"
  assert.equal(cutoutUrl('http://r', '/x.fits', 269.452, 4.693, 1), 'http://r/x.fits?center=269.452000,4.693000&size=0.2500');
});

test('stretch maps the 2nd..99.7th percentile to 0..255 and skips missing pixels', () => {
  const v = Array.from({ length: 1000 }, (_, i) => i); v.push(null, NaN);
  const s = stretch(v); assert.equal(s.map(-5), 0); assert.equal(s.map(5000), 255); assert.ok(s.map(500) > 128);
});

/* ---------- relay routes ---------- */
function fitsBytes(h, nx = 4, ny = 4) {
  const cards = Object.entries({ SIMPLE: true, BITPIX: -32, NAXIS: 2, NAXIS1: nx, NAXIS2: ny, ...h }).map(([k, v]) => {
    const val = typeof v === 'boolean' ? (v ? 'T' : 'F').padStart(20) : typeof v === 'number' ? String(v).padStart(20) : `'${v}'`;
    return (k.padEnd(8) + '= ' + val).padEnd(80);
  });
  cards.push('END'.padEnd(80));
  let head = cards.join(''); head = head.padEnd(Math.ceil(head.length / 2880) * 2880);
  const data = new Uint8Array(Math.ceil(nx * ny * 4 / 2880) * 2880);
  const out = new Uint8Array(head.length + data.length); out.set(new TextEncoder().encode(head)); out.set(data, head.length); return out;
}

test('relay: 2MASS Ks and AllWISE W1/W2 cutouts are allowed, unzipped and decoded', async () => {
  const fits = fitsBytes(H2M), log = [];
  const fetchFn = async (u) => { log.push(u); return new Response(gzipSync(fits), { headers: { 'Content-Type': 'application/gzip' } }); };
  const r = await handle(new Request('https://r.example/ibe/data/twomass/allsky/allsky/990916n/s028/image/ki0280150.fits.gz?center=269.452,4.693&size=0.12'), { fetchFn, cache: null });
  assert.equal(r.status, 200); assert.equal(r.headers.get('Content-Type'), 'application/fits');
  assert.equal(log[0], 'https://irsa.ipac.caltech.edu/ibe/data/twomass/allsky/allsky/990916n/s028/image/ki0280150.fits.gz?center=269.452,4.693&size=0.12');
  const d = decodeSurvey(new Uint8Array(await r.arrayBuffer()), 'twomass');
  assert.equal(d.meta.date, '1999-09-16'); assert.equal(d.image.nx, 4);
  for (const w of ['w1', 'w2']) {
    const rw = await handle(new Request(`https://r.example/ibe/data/wise/allwise/p3am_cdd/26/2688/2688p045_ac51/2688p045_ac51-${w}-int-3.fits?center=269.452,4.693&size=0.1`),
      { fetchFn: async () => new Response(fitsBytes(HW)), cache: null }); // not gzipped: passed through
    assert.equal(rw.status, 200, w);
  }
});

test('relay refuses other files, bands, paths and odd parameters for the survey routes', async () => {
  const log = []; const fetchFn = async (u) => { log.push(u); return new Response(fitsBytes(H2M)); };
  for (const bad of [
    '/ibe/data/twomass/allsky/allsky/990916n/s028/image/hi0280150.fits.gz?center=1,2&size=0.1', // H band, not Ks
    '/ibe/data/twomass/allsky/allsky/990916n/s028/glint.tbl?center=1,2&size=0.1',
    '/ibe/data/twomass/allsky/allsky/990916n/s028/image/ki0280150.fits.gz?center=1,2&size=0.3', // too big
    '/ibe/data/twomass/allsky/allsky/990916n/s028/image/ki0280150.fits.gz?center=1,2&size=0.001',
    '/ibe/data/twomass/allsky/allsky/990916n/s028/image/ki0280150.fits.gz?center=evil&size=0.1',
    '/ibe/data/twomass/allsky/allsky/990916n/s028/image/ki0280150.fits.gz?center=1,2&size=0.1&extra=1',
    '/ibe/data/twomass/allsky/allsky/990916n/../../x/image/ki0280150.fits.gz?center=1,2&size=0.1',
    '/ibe/data/wise/allwise/p3am_cdd/26/2688/2688p045_ac51/2688p045_ac51-w3-int-3.fits?center=1,2&size=0.1', // W3
    '/ibe/data/wise/allwise/p3am_cdd/26/2688/2688p045_ac51/2688p045_ac51-w1-unc-3.fits.gz?center=1,2&size=0.1',
    '/ibe/data/wise/allwise/p3am_cdd/26/2688/2688p045_ac51/2688p045_ac51-w1-int-3.fits',
    '/ibe/data/wise/neowiser/p1bm_frm/x-w1-int-1b.fits?center=1,2&size=0.1',
  ]) assert.ok((await handle(new Request('https://r.example' + bad), { fetchFn, cache: null })).status >= 400, bad);
  assert.equal(log.length, 0);
});

test('relay: IBE "busy" passes through as 503, a broken gzip is never cached', async () => {
  const put = []; const cache = { match: async () => undefined, put: async (k) => put.push(k) };
  const r1 = await handle(new Request('https://r.example/ibe/data/twomass/allsky/allsky/990916n/s028/image/ki0280150.fits.gz?center=1,2&size=0.1'),
    { fetchFn: async () => new Response('busy', { status: 503 }), cache });
  assert.equal(r1.status, 503);
  const r2 = await handle(new Request('https://r.example/ibe/data/twomass/allsky/allsky/990916n/s028/image/ki0280150.fits.gz?center=1,2&size=0.1'),
    { fetchFn: async () => new Response(gzipSync(fitsBytes(H2M)).slice(0, 60)), cache });
  assert.equal(r2.status, 503); assert.equal(put.length, 0);
});
