// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Slow-archive guard: a hung cutout request is dropped after timeoutMs and tried once more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchCutout } from '../web/core/irsa.js';
import { endsFirst } from '../web/app/data.js';

const bytes = new Uint8Array(readFileSync(new URL('./fixtures/cutout_3hdu.fits', import.meta.url)));
const URI = 'ibe/data/spherex/dr1/a.fits';
// A fetch that never answers until its signal aborts (like a stuck IRSA request).
const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));

test('fetchCutout: a hung request times out and the one retry succeeds', async () => {
  let calls = 0;
  const fetchFn = (url, opts) => (++calls === 1 ? hang(url, opts) : Promise.resolve(new Response(bytes)));
  const c = await fetchCutout(URI, 1, 2, 0.05, { fetchFn, timeoutMs: 30, backoffMs: 1 });
  assert.equal(calls, 2);
  assert.equal(c.image.nx, 29);
});

test('fetchCutout: gives up after one timeout retry (no endless waiting)', async () => {
  let calls = 0;
  const fetchFn = (url, opts) => { calls++; return hang(url, opts); };
  const t0 = Date.now();
  await assert.rejects(fetchCutout(URI, 1, 2, 0.05, { fetchFn, timeoutMs: 30, backoffMs: 1 }), /timed out/);
  assert.equal(calls, 2);
  assert.ok(Date.now() - t0 < 2000);
});

test('fetchCutout: the caller cancelling is not treated as a timeout (no retry)', async () => {
  let calls = 0;
  const ctl = new AbortController();
  const fetchFn = (url, opts) => { calls++; setTimeout(() => ctl.abort(), 5); return hang(url, opts); };
  await assert.rejects(fetchCutout(URI, 1, 2, 0.05, { fetchFn, signal: ctl.signal, timeoutMs: 5000, backoffMs: 1 }));
  assert.equal(calls, 1);
});

test('fetchCutout: 503 retries still work with the timeout in place, and the timer is cleared', async () => {
  let calls = 0;
  const fetchFn = async () => (++calls < 3 ? new Response('busy', { status: 503 }) : new Response(bytes));
  const c = await fetchCutout(URI, 1, 2, 0.05, { fetchFn, backoffMs: 1 }); // default 20 s timeout must not keep the test alive
  assert.equal(calls, 3);
  assert.equal(c.image.nx, 29);
});

test('fetch order: first and last season come before the middle ones', () => {
  const ims = [{ s: 1 }, { s: 1 }, { s: 2 }, { s: 2 }, { s: 3 }, { s: 3 }];
  const order = endsFirst(ims).map(x => x.s);
  assert.deepEqual(order.slice(0, 2), [1, 3]);
  assert.equal(order.at(-1), 2);
});
