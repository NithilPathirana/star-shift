// Tests for the Cloudflare Worker relay, with a fake upstream (offline).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle } from '../proxy/worker.js';
import { decodeCutout } from '../web/core/irsa.js';

const fixture = new Uint8Array(readFileSync(new URL('./fixtures/cutout_3hdu.fits', import.meta.url)));
const R = 'https://relay.example';

function fakeFetch(log) {
  return async (url) => {
    log.push(url);
    if (url.includes('/ibe/')) {
      const big = new Uint8Array(fixture.length + 4_000_000); // fixture + fake 4 MB PSF table
      big.set(fixture);
      return new Response(big, { status: 200 });
    }
    return new Response('a,b\n1,2\n', { status: 200, headers: { 'Content-Type': 'text/csv' } });
  };
}

test('cutouts are trimmed to IMAGE+FLAGS and still decode', async () => {
  const log = [];
  const res = await handle(new Request(`${R}/ibe/data/spherex/dr1/x/y.fits?center=269.4461,4.7707d&size=0.05`), { fetchFn: fakeFetch(log) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  const body = new Uint8Array(await res.arrayBuffer());
  assert.equal(body.length, fixture.length);
  assert.equal(decodeCutout(body).image.nx, 29);
  assert.equal(log[0], 'https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/x/y.fits?center=269.4461,4.7707d&size=0.05');
});

test('TAP and Gaia queries are relayed with CORS', async () => {
  const log = [];
  const q = encodeURIComponent('SELECT TOP 1 * FROM spherex.plane');
  let res = await handle(new Request(`${R}/TAP/sync?FORMAT=csv&QUERY=${q}`), { fetchFn: fakeFetch(log) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(await res.text(), 'a,b\n1,2\n');
  const gq = encodeURIComponent("SELECT TOP 50 source_id FROM gaiadr3.gaia_source WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',1,2,0.01))");
  res = await handle(new Request(`${R}/gaia/tap/sync?REQUEST=doQuery&QUERY=${gq}`), { fetchFn: fakeFetch(log) });
  assert.equal(res.status, 200);
  assert.ok(log[1].startsWith('https://gea.esac.esa.int/tap-server/tap/sync?'));
});

test('relay refuses anything else', async () => {
  const log = [];
  const bad = [
    '/ibe/data/other/x.fits?center=1,2&size=0.1',
    '/ibe/data/spherex/../../x.fits?center=1,2&size=0.1',
    '/ibe/data/spherex/x.fits?center=1,2&size=5',
    '/ibe/data/spherex/x.fits?center=evil&size=0.1',
    `/TAP/sync?QUERY=${encodeURIComponent('DROP TABLE x')}`,
    `/TAP/sync?QUERY=${encodeURIComponent('SELECT * FROM wise.allwise_p3as_psd')}`,
    `/gaia/tap/sync?QUERY=${encodeURIComponent('SELECT * FROM gaiadr3.gaia_source')}`,
    `/gaia/tap/sync?QUERY=${encodeURIComponent('SELECT TOP 99999 * FROM gaiadr3.gaia_source WHERE 1=CONTAINS(a,b)')}`,
    '/ibe/data/spherex/x.fits?center=1,2&size=0.6',
    '/ibe/data/spherex/x%2e%2e/y.fits?center=1,2&size=0.1',
    '/https://example.com/',
  ];
  for (const p of bad) {
    const res = await handle(new Request(R + p), { fetchFn: fakeFetch(log) });
    assert.ok(res.status >= 400, p);
  }
  const post = await handle(new Request(`${R}/TAP/sync`, { method: 'POST', body: 'x' }), { fetchFn: fakeFetch(log) });
  assert.equal(post.status, 405);
  assert.equal(log.length, 0, 'nothing forwarded');
  const pre = await handle(new Request(`${R}/TAP/sync`, { method: 'OPTIONS' }), { fetchFn: fakeFetch(log) });
  assert.equal(pre.status, 204);
});

test('stream reader rejects oversized input', async () => {
  const { readHDUsFromStream } = await import('../web/core/fits.js');
  const big = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1 << 20).fill(32)); } });
  await assert.rejects(readHDUsFromStream(big, 3, 4 << 20), /too large/);
});

test('stale cached copy is served when the archive fails (local server mode)', async () => {
  const store = new Map();
  const cache = {
    async match(req, { ignoreExpiry = false } = {}) { const e = store.get(req.url); return e && (ignoreExpiry || !e.expired) ? new Response(e.body, { headers: e.headers }) : undefined; },
    async put(req, res) { store.set(req.url, { body: await res.text(), headers: Object.fromEntries(res.headers), expired: false }); },
  };
  const q = encodeURIComponent('SELECT TOP 1 * FROM spherex.plane');
  const url = `${R}/TAP/sync?QUERY=${q}`;
  let r = await handle(new Request(url), { cache, fetchFn: async () => new Response('fresh'), staleIfError: true });
  assert.equal(await r.text(), 'fresh');
  for (const v of store.values()) v.expired = true;
  r = await handle(new Request(url), { cache, fetchFn: async () => new Response('busy', { status: 503 }), staleIfError: true });
  assert.equal(await r.text(), 'fresh');
  r = await handle(new Request(url), { cache, fetchFn: async () => { throw new TypeError('offline'); }, staleIfError: true });
  assert.equal(await r.text(), 'fresh');
  r = await handle(new Request(url), { cache: null, fetchFn: async () => { throw new TypeError('offline'); } });
  assert.equal(r.status, 504);
});
