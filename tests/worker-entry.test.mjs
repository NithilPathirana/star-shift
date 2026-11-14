// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleJpl, isRelayPath, routeRequest } from '../deploy/worker-entry.js';

const ORIGIN = 'https://star-shift.example';

function fakeAssets(log, files = new Map()) {
  return {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      log.push(`asset:${path}`);
      return files.get(path) || new Response('missing asset', { status: 404 });
    },
  };
}

test('a matching static asset wins before relay routing', async () => {
  const log = [];
  const env = { ASSETS: fakeAssets(log, new Map([
    ['/index.html', new Response('<!doctype html>', { status: 200 })],
  ])) };
  const relay = async () => { log.push('relay'); return new Response('relay'); };

  const response = await routeRequest(new Request(`${ORIGIN}/index.html`), env, {}, { relay });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<!doctype html>');
  assert.deepEqual(log, ['asset:/index.html']);
});

test('an approved relay path is tried only after a static miss', async () => {
  const log = [];
  const env = { ASSETS: fakeAssets(log) };
  const relay = async (request, options) => {
    log.push(`relay:${new URL(request.url).pathname}`);
    assert.ok(Object.hasOwn(options, 'cache'));
    return new Response('relay answer', {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  };

  const response = await routeRequest(
    new Request(`${ORIGIN}/SIA?COLLECTION=spherex_dr1&POS=circle+1+2+0.001`),
    env,
    {},
    { relay },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.deepEqual(log, ['asset:/SIA', 'relay:/SIA']);
});

test('unknown paths return 404 without reaching a relay', async () => {
  const log = [];
  const env = { ASSETS: fakeAssets(log) };
  const relay = async () => { log.push('relay'); return new Response('wrong'); };

  const response = await routeRequest(new Request(`${ORIGIN}/admin/secrets`), env, {}, { relay });

  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'Not found');
  assert.deepEqual(log, ['asset:/admin/secrets']);
});

test('JPL paths use the JPL handler, while lookalikes remain blocked', async () => {
  const log = [];
  const env = { ASSETS: fakeAssets(log) };
  const relay = async () => { log.push('relay'); return new Response('wrong'); };
  const jpl = async (request) => {
    log.push(`jpl:${new URL(request.url).pathname}`);
    return new Response('{}', { status: 200 });
  };

  let response = await routeRequest(
    new Request(`${ORIGIN}/jpl/sbdb?sstr=99942`), env, {}, { relay, jpl },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(log, ['asset:/jpl/sbdb', 'jpl:/jpl/sbdb']);

  log.length = 0;
  response = await routeRequest(new Request(`${ORIGIN}/jpl/anything`), env, {}, { relay, jpl });
  assert.equal(response.status, 404);
  assert.deepEqual(log, ['asset:/jpl/anything']);
});

test('the complete allow-list matches the existing relay surface only', () => {
  for (const path of [
    '/health', '/TAP/sync', '/SIA', '/gaia/tap/sync',
    '/ibe/data/spherex/dr1/file.fits', '/hips/spherex/33/Norder3/Dir0/Npix1.png',
    '/jpl/cad', '/jpl/sentry', '/jpl/sbdb', '/jpl/sb_ident', '/jpl/horizons',
  ]) assert.equal(isRelayPath(path), true, path);

  for (const path of ['/TAP', '/sia', '/gaia', '/ibe/data/other/file.fits', '/hips/other', '/jpl', '/jpl/nope']) {
    assert.equal(isRelayPath(path), false, path);
  }
});

test('JPL handling validates, adds CORS, and uses the Cache API', async () => {
  const calls = [];
  const store = new Map();
  const cache = {
    async match(request) { return store.get(request.url)?.clone(); },
    async put(request, response) { store.set(request.url, response.clone()); },
  };
  const fetchFn = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ object: { fullname: '99942 Apophis' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const request = new Request(`${ORIGIN}/jpl/sbdb?sstr=99942`);

  let response = await handleJpl(request, { fetchFn, cache });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(response.headers.get('Cache-Control'), /max-age=3600/);
  assert.equal((await response.json()).object.fullname, '99942 Apophis');

  response = await handleJpl(request, {
    fetchFn: async () => { throw new Error('cache miss'); },
    cache,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).object.fullname, '99942 Apophis');
  assert.equal(calls.length, 1);

  response = await handleJpl(new Request(`${ORIGIN}/jpl/sbdb?url=https://example.com`), { fetchFn, cache });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 1, 'invalid parameters must not reach JPL');
});

test('deploy entry routes the 2MASS / AllWISE survey cutouts to the relay', () => {
  assert.equal(isRelayPath('/ibe/data/twomass/allsky/allsky/990214n/s001/image/ki0010044.fits.gz'), true);
  assert.equal(isRelayPath('/ibe/data/wise/allwise/p3am_cdd/26/2692/2692p045_ac51/2692p045_ac51-w1-int-3.fits'), true);
  assert.equal(isRelayPath('/ibe/data/twomass/other.fits'), false);
});
