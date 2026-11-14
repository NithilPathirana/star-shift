// Tests for web/core/prebaked.js: exact manifest hits come from the files, everything else goes live.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { prebakedFetch, prebakedKey, configurePrebaked } from '../web/core/prebaked.js';
import { listImagesSIA, cutoutUrl } from '../web/core/irsa.js';
import { buildSbIdentParams } from '../web/app/neo/sb-ident.js';

const ORIGIN = 'https://star-shift.example';
const FILES = `${ORIGIN}/prebaked/`;
const SIA_KEY = '/SIA?COLLECTION=spherex_dr1&POS=circle+269.452077+4.693365+0.0005&RESPONSEFORMAT=VOTABLE';
const SIMBAD_KEY = 'https://simbad.harvard.edu/simbad/sim-tap/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=SELECT%20TOP%201';
const JPL_KEY = `/jpl/sb_ident?${buildSbIdentParams({ ra: 269.4461, dec: 4.7707, fov: 0.5, date: '2025-08-15', kind: 'a' })}`;

// A fake network: the manifest, two files, and a "live" answer for anything else. Records every URL asked.
function setup({ manifest = true, fileStatus = 200 } = {}) {
  const asked = [];
  const files = { 'barnard/sia.xml': 'PREBAKED-SIA', 'barnard/simbad.csv': 'PREBAKED-SIMBAD', 'neo/jpl.json': 'PREBAKED-JPL' };
  const fetchImpl = async (url) => {
    asked.push(String(url));
    if (url === FILES + 'manifest.json') {
      if (!manifest) return new Response('Not found', { status: 404 });
      return Response.json({ entries: {
        [SIA_KEY]: { file: 'barnard/sia.xml', size: 12, fetched: '2026-11-15T00:00:00Z' },
        [SIMBAD_KEY]: { file: 'barnard/simbad.csv', size: 15 },
        [JPL_KEY]: { file: 'neo/jpl.json', size: 12 },
      } });
    }
    const f = String(url).startsWith(FILES) && files[String(url).slice(FILES.length)];
    if (f) return new Response(fileStatus === 200 ? f : 'gone', { status: fileStatus });
    return new Response('LIVE', { status: 200 });
  };
  const live = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { live.push(String(url)); return new Response('LIVE', { status: 200 }); };
  configurePrebaked({ manifestUrl: FILES + 'manifest.json', fileBase: FILES, origin: ORIGIN, fetchImpl });
  return { asked, live, restore: () => { globalThis.fetch = realFetch; configurePrebaked(null); } };
}

test('prebakedKey: path and query relative to the page origin; other hosts keep the full URL; spaces encoded', () => {
  assert.equal(prebakedKey(ORIGIN + SIA_KEY, ORIGIN), SIA_KEY);
  assert.equal(prebakedKey(SIA_KEY, ORIGIN), SIA_KEY);
  assert.equal(prebakedKey(new URL(ORIGIN + '/jpl/sb_ident?a=1'), ORIGIN), '/jpl/sb_ident?a=1');
  assert.equal(prebakedKey(SIMBAD_KEY, ORIGIN), SIMBAD_KEY);
  assert.equal(prebakedKey('https://x.test/a b', ORIGIN), 'https://x.test/a%20b');
  assert.equal(prebakedKey(ORIGIN + 'evil.test/x', ORIGIN), ORIGIN + 'evil.test/x', 'a look-alike host is not stripped');
  // full doubles that differ only in the last bit (Node vs browser maths) give the same key; 6-decimal values are untouched
  assert.equal(prebakedKey('https://s.test/q?c=269.44607272345866,4.5', ORIGIN), prebakedKey('https://s.test/q?c=269.4460727234587,4.5', ORIGIN));
  assert.notEqual(prebakedKey('https://s.test/q?c=269.4460727234,-4.5', ORIGIN), prebakedKey('https://s.test/q?c=269.4460727235,-4.5', ORIGIN));
  assert.equal(prebakedKey(SIA_KEY, ORIGIN), SIA_KEY);
});

test('a manifest hit is answered from the prebaked file (absolute, relative and other-host URLs)', async () => {
  const s = setup();
  try {
    assert.equal(await (await prebakedFetch(ORIGIN + SIA_KEY)).text(), 'PREBAKED-SIA');
    assert.equal(await (await prebakedFetch(JPL_KEY)).text(), 'PREBAKED-JPL');
    assert.equal(await (await prebakedFetch(SIMBAD_KEY, { signal: AbortSignal.timeout(5000) })).text(), 'PREBAKED-SIMBAD');
    assert.deepEqual(s.live, [], 'nothing went to the network');
    assert.equal(s.asked.filter(u => u.endsWith('manifest.json')).length, 1, 'the manifest is loaded once');
  } finally { s.restore(); }
});

test('a miss goes live unchanged: other positions, other params, other param order, non-GET', async () => {
  const s = setup();
  try {
    const misses = [
      ORIGIN + SIA_KEY.replace('269.452077', '269.452078'),
      ORIGIN + SIA_KEY + '&extra=1',
      ORIGIN + '/SIA?POS=circle+269.452077+4.693365+0.0005&COLLECTION=spherex_dr1&RESPONSEFORMAT=VOTABLE',
      JPL_KEY.replace('2025-08-15', '2025-08-16'),
      ORIGIN + '/ibe/data/spherex/qr/level2/x.fits?center=1,2d&size=0.05',
    ];
    for (const u of misses) assert.equal(await (await prebakedFetch(u)).text(), 'LIVE', u);
    assert.equal(await (await prebakedFetch(ORIGIN + SIA_KEY, { method: 'POST' })).text(), 'LIVE');
    assert.deepEqual(s.live, [...misses, ORIGIN + SIA_KEY]);
  } finally { s.restore(); }
});

test('no manifest, or a missing file: everything falls back to the network', async () => {
  let s = setup({ manifest: false });
  try { assert.equal(await (await prebakedFetch(ORIGIN + SIA_KEY)).text(), 'LIVE'); assert.equal(s.live.length, 1); } finally { s.restore(); }
  s = setup({ fileStatus: 404 });
  try { assert.equal(await (await prebakedFetch(ORIGIN + SIA_KEY)).text(), 'LIVE'); assert.equal(s.live.length, 1); } finally { s.restore(); }
});

test('without a page (Node tools) prebakedFetch is a plain fetch', async () => {
  const realFetch = globalThis.fetch; const live = [];
  globalThis.fetch = async (url) => { live.push(String(url)); return new Response('LIVE'); };
  try { configurePrebaked(null); assert.equal(await (await prebakedFetch(SIA_KEY)).text(), 'LIVE'); assert.deepEqual(live, [SIA_KEY]); }
  finally { globalThis.fetch = realFetch; }
});

test('the app\'s own URL builders produce keys that hit (irsa.js SIA uses the prebaked fetch by default)', async () => {
  const s = setup();
  try {
    // listImagesSIA asks both collections; only DR1 is in the fake manifest, so QR3 goes live (and is not a VOTable).
    await assert.rejects(listImagesSIA(269.4520769586187, 4.693364966576667, { base: ORIGIN }));
    assert.ok(s.asked.includes(FILES + 'barnard/sia.xml'), 'DR1 list came from the prebaked file');
    assert.ok(s.live.some(u => u.includes('spherex_qr3')), 'QR3 went live');
    assert.ok(cutoutUrl('ibe/data/spherex/a.fits', 1, 2, 0.05, ORIGIN).startsWith(ORIGIN + '/ibe/'));
  } finally { s.restore(); }
});

// The real export (when present): every entry has its file, at the stated size.
const MANIFEST = new URL('../web/prebaked/manifest.json', import.meta.url);
test('web/prebaked/manifest.json (if exported) lists files that exist with the stated sizes', { skip: !existsSync(MANIFEST) }, () => {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const entries = Object.entries(m.entries);
  assert.ok(entries.length > 0);
  for (const [key, e] of entries) {
    assert.ok(key.startsWith('/') || key.startsWith('https://simbad.'), key);
    assert.ok(!/\s/.test(key), 'keys have no raw spaces');
    const st = statSync(new URL('../web/prebaked/' + e.file, import.meta.url));
    assert.equal(st.size, e.size, e.file);
  }
});
