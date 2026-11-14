// Tests for the local server (static files + relay), offline with a fake upstream.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, diskCache } from '../server/server.mjs';

const fixture = new Uint8Array(readFileSync(new URL('./fixtures/cutout_3hdu.fits', import.meta.url)));

test('local server: static files, traversal blocked, relay + disk cache', async () => {
  let upstreamCalls = 0;
  const fakeFetch = async () => { upstreamCalls++; const b = new Uint8Array(fixture.length + 500000); b.set(fixture); return new Response(b); };
  const cache = diskCache(mkdtempSync(join(tmpdir(), 'relaycache-')));
  const server = createApp({ cache, fetchFn: fakeFetch }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let r = await fetch(base + '/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    r = await fetch(base + '/core/fits.js');
    assert.match(r.headers.get('content-type'), /javascript/);
    for (const p of ['/..%2fpackage.json', '/..%5cpackage.json', '/%2e%2e/package.json']) {
      r = await fetch(base + p);
      assert.ok(r.status === 403 || r.status === 404, p);
    }
    const cut = '/ibe/data/spherex/dr1/a/b.fits?center=1,2d&size=0.05';
    r = await fetch(base + cut);
    assert.equal(r.status, 200);
    assert.equal((await r.arrayBuffer()).byteLength, fixture.length);
    r = await fetch(base + cut);
    assert.equal((await r.arrayBuffer()).byteLength, fixture.length);
    assert.equal(upstreamCalls, 1, 'second request served from disk cache');
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    r = await fetch(base + '/health');
    assert.equal(await r.text(), 'ok');
  } finally {
    server.close();
  }
});
