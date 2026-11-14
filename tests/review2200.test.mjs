// Fixes from the 22:00 review (evidence/gemini-review-2200.md): truncated cutouts, blind
// proper-motion measurement, strict TAP relay checks, coordinate formatting/parsing,
// observer maths (precession, current pass) and flag/NaN reprojection.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle } from '../proxy/worker.js';
import { readHDUsFromStream } from '../web/core/fits.js';
import { fetchCutout, decodeCutout, listImagesTAP } from '../web/core/irsa.js';
import { gaiaCone } from '../web/core/resolve.js';
import { measureMotion } from '../web/app/data.js';
import { makeGrid, worldToGrid, reproject } from '../web/core/align.js';
import { propagate, epochYearToMjd, parseAngle } from '../web/core/motion.js';
import { formatRA, formatDec, parseQuery } from '../web/app/query.js';
import { altAz, riseTransitSet, precessFromJ2000, julianDate } from '../web/app/sky.js';

const fixture = new Uint8Array(readFileSync(new URL('./fixtures/cutout_3hdu.fits', import.meta.url)));
const R = 'https://relay.example';
const chunked = (bytes, size = 4096) => {
  let at = 0;
  return new ReadableStream({ pull(c) { if (at >= bytes.length) return c.close(); c.enqueue(bytes.slice(at, at + size)); at += size; } });
};
const memCache = () => {
  const store = new Map();
  return {
    store,
    async match(req) { const e = store.get(req.url); return e ? new Response(e.body, { headers: e.headers }) : undefined; },
    async put(req, res) { store.set(req.url, { body: new Uint8Array(await res.arrayBuffer()), headers: Object.fromEntries(res.headers) }); },
  };
};

// ---- 1. truncated cutouts ---------------------------------------------------------
test('stream that ends mid-HDU is rejected, not returned as partial bytes', async () => {
  for (const cut of [fixture.length - 1, fixture.length - 2880, 4000, 100]) {
    await assert.rejects(readHDUsFromStream(chunked(fixture.slice(0, cut)), 3), /truncated/, `cut at ${cut}`);
  }
  // ends exactly after HDU 2 of 3: still incomplete
  await assert.rejects(readHDUsFromStream(chunked(fixture.slice(0, 2880 * 2)), 3), /truncated/);
  assert.equal((await readHDUsFromStream(chunked(fixture), 3)).length, fixture.length);
});

test('relay: truncated upstream cutout -> 503, not cached; a later full copy is cached', async () => {
  const cache = memCache();
  const url = `${R}/ibe/data/spherex/dr1/x/y.fits?center=269.4461,4.7707d&size=0.05`;
  let r = await handle(new Request(url), { cache, fetchFn: async () => new Response(chunked(fixture.slice(0, 9000))) });
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.equal(cache.store.size, 0, 'nothing cached');
  r = await handle(new Request(url), { cache, fetchFn: async () => new Response(chunked(fixture)) });
  assert.equal(r.status, 200);
  assert.equal(cache.store.size, 1);
  // cache key unchanged: the plain IRSA URL (keeps the pre-baked cache valid)
  assert.ok(cache.store.has('https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/x/y.fits?center=269.4461,4.7707d&size=0.05'));
});

test('client: incomplete file is never decoded and a cut-off body is retried', async () => {
  assert.throws(() => decodeCutout(fixture.slice(0, fixture.length - 10)), /incomplete/);
  let calls = 0;
  const fetchFn = async () => (++calls === 1 ? new Response(chunked(fixture.slice(0, 7000))) : new Response(chunked(fixture)));
  const c = await fetchCutout('ibe/data/spherex/dr1/x/y.fits', 269.4461, 4.7707, 0.05, { fetchFn, backoffMs: 1 });
  assert.equal(calls, 2);
  assert.equal(c.image.nx, 29);
  // gives up after `retries`
  await assert.rejects(fetchCutout('ibe/data/spherex/dr1/x/y.fits', 1, 2, 0.05,
    { fetchFn: async () => new Response(chunked(fixture.slice(0, 7000))), retries: 2, backoffMs: 1 }), /truncated/);
});

// ---- 2. proper motion measured from the frames alone ------------------------------
// SPHEREx-like sampling: a cluster of visits every ~6 months.
function movingStarFrames({ pmra = -800, pmdec = 10300, withExpected = false, expectPm = null, neighbour = false, cosmic = -1 } = {}) {
  const star = { ra: 269.45, dec: 4.69, pmra, pmdec, epoch: 2026.0 };
  // the typed coordinates are an older position (epoch 2024.5): the star drifts 1-4 px from the centre
  const typed = propagate(star, epochYearToMjd(2024.5));
  const grid = makeGrid(typed.ra, typed.dec, 180);
  const frames = [];
  let k = 0;
  for (const season of [2025.3, 2025.8, 2026.3, 2026.8]) {
    for (let v = 0; v < 6; v++, k++) {
      const mjd = epochYearToMjd(season + v * 0.01);
      const p = propagate(star, mjd);
      const [x, y] = worldToGrid(grid, p.ra, p.dec);
      const data = new Float32Array(grid.n * grid.n);
      for (let j = 0; j < grid.n; j++) for (let i = 0; i < grid.n; i++) {
        let val = 10 + ((i * 7 + j * 13 + k) % 5) * 0.3 + 500 * Math.exp(-((i - x) ** 2 + (j - y) ** 2) / (2 * 1.1 ** 2));
        if (neighbour) val += 300 * Math.exp(-((i - grid.c - 6) ** 2 + (j - grid.c + 1) ** 2) / (2 * 1.1 ** 2)); // fixed star 6 px away
        data[j * grid.n + i] = val;
      }
      if (k === cosmic) data[Math.round(y) * grid.n + Math.round(x) + 2] += 3000; // hit beside the star
      let expected = null;
      if (withExpected) {
        const q = expectPm ? propagate({ ...star, ...expectPm }, mjd) : p;
        expected = worldToGrid(grid, q.ra, q.dec);
      }
      frames.push({ n: grid.n, data, mjd, expected });
    }
  }
  return { frames, grid };
}
const near = (m, pmra, pmdec, tol = 400) => Math.abs(m.pmra - pmra) < tol && Math.abs(m.pmdec - pmdec) < tol;

test('motion: coordinate search (no catalogue PM, no expected positions)', () => {
  const { frames, grid } = movingStarFrames();
  const m = measureMotion(frames, grid);
  assert.ok(m.ok, JSON.stringify(m));
  assert.equal(m.seeded, 'blind');
  assert.ok(near(m, -800, 10300), JSON.stringify({ pmra: m.pmra, pmdec: m.pmdec }));
  assert.ok(m.totalErr > 0 && m.totalErr < 400);
  assert.equal(m.frames, 24);
});

test('motion: with expected positions, and found independently of a wrong catalogue PM', () => {
  const { frames, grid } = movingStarFrames({ withExpected: true });
  const m = measureMotion(frames, grid);
  assert.ok(m.ok && m.seeded === 'catalogue' && near(m, -800, 10300), JSON.stringify(m));
  // catalogue says "not moving": the star still gets tracked to its real motion
  const w = movingStarFrames({ withExpected: true, expectPm: { pmra: 0, pmdec: 0 } });
  const mw = measureMotion(w.frames, w.grid);
  assert.ok(mw.ok && near(mw, -800, 10300), JSON.stringify(mw));
});

test('motion: any subset / order of frames, neighbour star and cosmic ray do not derail it', () => {
  const { frames, grid } = movingStarFrames({ neighbour: true, cosmic: 13 });
  const shuffled = frames.slice().reverse();
  const m = measureMotion(shuffled, grid);
  assert.ok(m.ok && near(m, -800, 10300), JSON.stringify(m));
  const subset = frames.filter((_, k) => k % 3 !== 1); // e.g. contamination filter dropped some
  const ms = measureMotion(subset, grid);
  assert.ok(ms.ok && near(ms, -800, 10300, 600), JSON.stringify(ms));
  assert.equal(measureMotion(frames.slice(0, 6), grid).ok, false); // one season: no time baseline
  assert.equal(measureMotion([], grid).ok, false);
  // empty sky: nothing to measure
  const blank = frames.map(f => ({ ...f, data: new Float32Array(f.data.length).fill(10) }));
  assert.equal(measureMotion(blank, grid).ok, false);
});

// ---- 4. strict TAP relay checks ---------------------------------------------------
test('relay: ADQL comment / parameter-pollution / subquery bypasses are refused', async () => {
  const log = [];
  const fetchFn = async (u) => { log.push(u); return new Response('a\n1\n'); };
  const e = encodeURIComponent;
  const bad = [
    `/TAP/sync?QUERY=${e('SELECT * FROM TAP_SCHEMA.tables -- spherex.obscore')}`,
    `/TAP/sync?QUERY=${e('SELECT * FROM TAP_SCHEMA.tables /* spherex.obscore */')}`,
    `/TAP/sync?QUERY=${e("SELECT * FROM wise.allwise_p3as_psd WHERE x = 'spherex.obscore'")}`,
    `/TAP/sync?QUERY=${e('SELECT 1 FROM spherex.obscore')}&query=${e('SELECT * FROM wise.allwise_p3as_psd')}`,
    `/TAP/sync?QUERY=${e('SELECT 1 FROM spherex.obscore')}&QUERY=${e('SELECT * FROM wise.allwise_p3as_psd')}`,
    `/TAP/sync?query=${e('SELECT * FROM wise.allwise_p3as_psd')}`,
    `/TAP/sync?QUERY=${e('SELECT * FROM spherex.plane; SELECT * FROM wise.x')}`,
    `/TAP/sync?QUERY=${e('SELECT * FROM spherex.plane, wise.allwise_p3as_psd')}`,
    `/TAP/sync?QUERY=${e('SELECT * FROM spherex.plane p JOIN wise.allwise_p3as_psd w ON p.x = w.x')}`,
    `/TAP/sync?QUERY=${e('SELECT * FROM spherex.plane WHERE x IN (SELECT y FROM wise.allwise_p3as_psd)')}`,
    `/TAP/sync?QUERY=${e('SELECT * FROM (SELECT * FROM wise.allwise_p3as_psd) AS spherex')}`,
    `/TAP/sync?QUERY=${e('SELECT * FROM spherex.plane UNION SELECT * FROM wise.x')}`,
    `/TAP/sync?QUERY=${e('SELECT * FROM "TAP_SCHEMA"."tables" s, spherex.plane')}`,
    `/TAP/sync?QUERY=${e("SELECT * FROM spherex.plane WHERE x = 'unterminated")}`,
    `/TAP/sync?QUERY=${e('SELECT * FROM spherex.plane')}&UPLOAD=t,http://evil/x`,
    `/TAP/sync?QUERY=${e('SELECT * FROM spherex.plane')}&LANG=PQL`,
    `/gaia/tap/sync?QUERY=${e("SELECT TOP 5 * FROM gaiadr3.gaia_source WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',1,2,0.1))")}&query=${e('SELECT TOP 5 * FROM user_x.secret')}`,
    `/gaia/tap/sync?QUERY=${e("SELECT TOP 5 * FROM user_x.secret -- gaiadr3.gaia_source CONTAINS(")}`,
    `/gaia/tap/sync?QUERY=${e("SELECT TOP 5 * FROM gaiadr3.gaia_source g, user_x.secret s WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',1,2,0.1))")}`,
  ];
  for (const p of bad) {
    const r = await handle(new Request(R + p), { fetchFn });
    assert.equal(r.status, 400, p);
  }
  assert.equal(log.length, 0, 'nothing forwarded');
});

test("relay: the app's own TAP queries still pass, forwarded byte-for-byte (cache keys unchanged)", async () => {
  const log = [];
  const fetchFn = async (u) => {
    const r = await handle(new Request(u), { fetchFn: async (up) => { log.push({ u, up }); return new Response('source_id,ra,dec\n1,2,3\n'); } });
    return r;
  };
  await listImagesTAP(269.4461, 4.7707, { base: R, fetchFn });
  await listImagesTAP(269.4461, 4.7707, { base: R, fetchFn, detectors: [1, 3] });
  await gaiaCone(269.4461, 4.7707, 30, { endpoint: `${R}/gaia/tap/sync`, fetchFn, top: 20 });
  assert.equal(log.length, 3, JSON.stringify(log));
  for (const { u, up } of log) assert.equal(new URL(up).search, new URL(u).search);
});

// ---- 5. coordinates ---------------------------------------------------------------
test('sexagesimal formatting rolls over instead of printing 60', () => {
  assert.equal(formatRA(14.99999), '01h 00m 00.00s');
  assert.equal(formatRA(359.99999), '00h 00m 00.00s');
  assert.equal(formatRA(269.4461), '17h 57m 47.06s');
  assert.equal(formatDec(14.99999), '+15° 00′ 00.0″');
  assert.equal(formatDec(-(1 + 59 / 60 + 59.97 / 3600)), '−02° 00′ 00.0″');
  assert.equal(formatDec(-1e-9), '+00° 00′ 00.0″'); // no "−00"
  assert.equal(formatDec(4.6933), '+04° 41′ 35.9″');
  // round trip through the parser for many values
  for (let k = 0; k < 500; k++) {
    const ra = (k * 7.123457) % 360, dec = ((k * 3.33331) % 180) - 90;
    const q = parseQuery(`${formatRA(ra)} ${formatDec(dec)}`);
    assert.ok(Math.abs(((q.ra - ra + 540) % 360) - 180) < 0.0002 && Math.abs(q.dec - dec) < 0.0001, `${ra} ${dec}`);
  }
});

test('RA typed in degrees with ° / d is read as degrees, hours stay hours', () => {
  const close = (q, ra, dec) => Math.abs(q.ra - ra) < 1e-4 && Math.abs(q.dec - dec) < 1e-4;
  assert.ok(close(parseQuery(`269° 26' 46" +04° 46' 26"`), 269 + 26 / 60 + 46 / 3600, 4 + 46 / 60 + 26 / 3600));
  assert.ok(close(parseQuery('269d26m46s +4d46m26s'), 269 + 26 / 60 + 46 / 3600, 4 + 46 / 60 + 26 / 3600));
  assert.ok(close(parseQuery('17h57m48.5s +4d41m36s'), 269.452083, 4.693333));
  assert.ok(close(parseQuery('17 57 48.5 +04 41 36'), 269.452083, 4.693333));
  assert.ok(close(parseQuery('17:57:48.5 +04:41:36'), 269.452083, 4.693333));
  assert.ok(close(parseQuery('269.45 +4.69'), 269.45, 4.69));
});

test('parseAngle accepts the Unicode minus that our own formatter prints', () => {
  assert.ok(Math.abs(parseAngle('−07 14 42.53', false) + (7 + 14 / 60 + 42.53 / 3600)) < 1e-9);
  assert.equal(parseAngle('−5.5', false), -5.5);
  assert.equal(parseAngle('–5.5', false), -5.5);
  assert.ok(Math.abs(parseAngle(formatDec(-7.2451), false) + 7.2451) < 1e-4);
});

// ---- 7. observer maths ------------------------------------------------------------
test('alt/az precesses catalogue J2000 positions to the date', () => {
  const now = new Date(Date.UTC(2026, 10, 14, 18));
  const [ra, dec] = precessFromJ2000(269.4461, 4.7707, julianDate(now));
  assert.ok(Math.hypot(ra - 269.4461, dec - 4.7707) > 0.2, 'precession over 26 years is ~0.36°');
  const a = altAz(269.4461, 4.7707, 7.3, 79.86, now), b = altAz(ra, dec, 7.3, 79.86, now, { j2000: false });
  assert.ok(Math.abs(a.alt - b.alt) < 1e-9 && Math.abs(a.az - b.az) < 1e-9);
});

test('rise/transit/set: while the star is up, set is later today (not tomorrow)', () => {
  const lat = 7.3, lon = 79.86, ra = 269.4461, dec = 4.7707, DAY = 86400000;
  const base = riseTransitSet(ra, dec, lat, lon, new Date(Date.UTC(2026, 10, 14, 0)));
  // one hour after the transit
  const t = new Date(base.transit.getTime() + 3600000);
  const r = riseTransitSet(ra, dec, lat, lon, t);
  assert.equal(r.up, true);
  assert.ok(r.transit < t && t - r.transit < 3700000, 'this pass\'s transit (in the past)');
  assert.ok(r.set > t && r.set - t < 7 * 3600000, `set in < 7 h, got ${(r.set - t) / 3600000} h`);
  assert.ok(r.rise < t);
  assert.ok(Math.abs(altAz(ra, dec, lat, lon, r.set).alt + 0.5667) < 0.05, 'set at the -0.5667° horizon');
  assert.ok(Math.abs(altAz(ra, dec, lat, lon, r.rise).alt + 0.5667) < 0.05);
  // below the horizon: the next rise/transit/set are all ahead
  const later = new Date(r.set.getTime() + 3600000);
  const n = riseTransitSet(ra, dec, lat, lon, later);
  assert.equal(n.up, false);
  assert.ok(n.rise > later && n.transit > n.rise && n.set > n.transit && n.set - later < DAY);
});

// ---- 8. flags follow the NaN pixels through reprojection ------------------------------
test('reproject: every NaN grid pixel caused by a masked pixel carries its flag bits', () => {
  const nx = 20, ny = 20;
  const img = new Float32Array(nx * ny).fill(5), flg = new Int32Array(nx * ny);
  img[10 * nx + 10] = NaN; flg[10 * nx + 10] = 1 << 11; // masked cosmic ray
  // grid shifted by half a pixel from the cutout: bilinear spreads the NaN over 4 grid pixels
  const g = makeGrid(0, 0, 20 * 6.15);
  const wcs = { worldToPix: (ra, dec) => { const [i, j] = worldToGrid(g, ra, dec); return [i + 0.5, j + 0.5]; } };
  const r = reproject({ image: { nx, ny, data: img }, flags: { nx, ny, data: flg }, wcs }, g);
  let nan = 0;
  for (let k = 0; k < r.data.length; k++) {
    if (!Number.isNaN(r.data[k])) continue;
    const i = k % g.n, j = Math.floor(k / g.n);
    if (i + 0.5 > nx - 1 || j + 0.5 > ny - 1) { assert.equal(r.flags[k], 0, 'outside the cutout: no flags'); continue; }
    nan++;
    assert.ok(r.flags[k] & (1 << 11), `NaN at ${i},${j} without its flag`);
  }
  assert.equal(nan, 4, 'bilinear spread the bad pixel over 4 grid pixels');
  // pixels that are fine keep nearest-neighbour flags (no dilation of other bits)
  assert.equal(r.flags.filter(f => f).length, 4);
});
