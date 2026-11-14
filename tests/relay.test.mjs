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
  res = await handle(new Request(`${R}/gaia/tap/sync?REQUEST=doQuery&QUERY=${q}`), { fetchFn: fakeFetch(log) });
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
