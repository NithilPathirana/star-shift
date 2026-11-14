// Tests for the per-channel SPHEREx HiPS route and palette tinting (offline).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, crc32 as zcrc } from 'node:zlib';
import { hipsRoute, channelProperties, tintPalettePNG, crc32, CHANNEL_UM, realChannel } from '../proxy/hips.js';
import { handle } from '../proxy/worker.js';

const U = (p) => new URL('https://r.example' + p);

test('channel routes map to IRSA cube tile names', () => {
  assert.equal(hipsRoute(U('/hips/spherex/0/Norder3/Dir0/Npix12.png')).target.endsWith('/Norder3/Dir0/Npix12.png'), true);
  assert.equal(hipsRoute(U('/hips/spherex/30/Norder5/Dir10000/Npix12000.png')).target.endsWith('/Norder5/Dir10000/Npix12000_30.png'), true);
  assert.equal(hipsRoute(U('/hips/spherex/50/Norder3/Allsky.png')).target.endsWith('/Norder3/Allsky_49.png'), true);
  assert.equal(hipsRoute(U('/hips/spherex/7/properties')).kind, 'hips-props');
  assert.equal(hipsRoute(U('/hips/spherex/7/Norder2/Dir0/Npix1.png?tint=ff8800')).tint, 'ff8800');
  for (const bad of ['/hips/spherex/102/properties', '/hips/spherex/1/Norder6/Dir0/Npix1.png', '/hips/spherex/1/Norder2/Dir0/Npix999.png',
    '/hips/spherex/1/Norder5/Dir0/Npix12000.png', '/hips/spherex/1/Norder2/Dir0/Npix1.png?tint=red'])
    assert.ok(hipsRoute(U(bad))?.error, bad);
  assert.equal(hipsRoute(U('/hips/other/1/properties')), null);
  assert.equal(CHANNEL_UM.length, 102);
  assert.equal(realChannel(51), 52);
});

test('properties become a plain single-channel image HiPS', () => {
  const src = 'hips_order = 5\ndataproduct_type     = cube\nhips_cube_depth = 102\ndata_cube_crval3_arr = 1 2\nhips_tile_format = png\n';
  const out = channelProperties(src, 3);
  assert.match(out, /dataproduct_type\s+= image/);
  assert.doesNotMatch(out, /cube_depth|crval3/);
  assert.match(out, /hips_order = 5/);
  assert.match(out, /0\.809 um/);
});

function palettePng(entries) {
  const chunk = (type, data) => {
    const b = new Uint8Array(12 + data.length); const v = new DataView(b.buffer);
    v.setUint32(0, data.length); b.set(new TextEncoder().encode(type), 4); b.set(data, 8);
    v.setUint32(8 + data.length, crc32(b.subarray(4, 8 + data.length))); return b;
  };
  const ihdr = new Uint8Array(13); const iv = new DataView(ihdr.buffer); iv.setUint32(0, 1); iv.setUint32(4, 1); ihdr[8] = 8; ihdr[9] = 3;
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', ihdr), chunk('PLTE', Uint8Array.from(entries.flat())),
    chunk('IDAT', deflateSync(Uint8Array.of(0, 0))), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}

test('palette tint recolours grey entries and keeps a valid CRC', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const png = palettePng([[0, 0, 0], [255, 255, 255], [128, 128, 128]]);
  const t = tintPalettePNG(png, 'ff8000');
  const i = 8 + 25 + 8; // after signature + IHDR chunk + PLTE header
  assert.deepEqual(Array.from(t.subarray(i, i + 9)), [0, 0, 0, 255, 128, 0, 128, 64, 0]);
  const plteLen = 9, crcAt = i + plteLen;
  assert.equal(new DataView(t.buffer).getUint32(crcAt), zcrc(t.subarray(i - 4, i + plteLen)));
  assert.deepEqual(tintPalettePNG(Uint8Array.of(1, 2, 3), 'ffffff'), Uint8Array.of(1, 2, 3));
});

test('relay serves tinted tiles and per-channel properties', async () => {
  const png = palettePng([[255, 255, 255]]);
  const fetchFn = async (url) => (url.endsWith('properties') ? new Response('hips_order = 5\nhips_cube_depth = 102\n') : new Response(png));
  let r = await handle(new Request('https://r.example/hips/spherex/4/Norder3/Dir0/Npix5_bad.png'), { fetchFn, cache: null });
  assert.equal(r.status, 404);
  r = await handle(new Request('https://r.example/hips/spherex/4/Norder3/Dir0/Npix5.png?tint=00ff00'), { fetchFn, cache: null });
  assert.equal(r.headers.get('content-type'), 'image/png');
  const b = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual(Array.from(b.subarray(41, 44)), [0, 255, 0]);
  r = await handle(new Request('https://r.example/hips/spherex/4/properties'), { fetchFn, cache: null });
  const txt = await r.text();
  assert.match(txt, /dataproduct_type\s+= image/);
  assert.doesNotMatch(txt, /cube_depth/);
});
