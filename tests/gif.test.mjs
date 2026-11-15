// Tests for web/app/gif.js ("Save as GIF"): a valid GIF89a file (header, trailer, frame count) whose
// LZW data decodes back to exactly the pixels that went in.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGif, gifFromRGBA, buildPalette, lzw } from '../web/app/gif.js';

// a minimal GIF reader for the test: blocks, frame count, delays, and LZW-decoded indices
function readGif(b) {
  const head = String.fromCharCode(...b.subarray(0, 6)), w = b[6] | (b[7] << 8), h = b[8] | (b[9] << 8), pk = b[10];
  let p = 13; if (pk & 0x80) p += 3 * (1 << ((pk & 7) + 1));
  const frames = []; let delay = 0, loop = false, trailer = false;
  while (p < b.length) {
    const t = b[p++];
    if (t === 0x3B) { trailer = p === b.length; break; }
    if (t === 0x21) {
      const label = b[p++];
      if (label === 0xF9) delay = b[p + 2] | (b[p + 3] << 8);
      if (label === 0xFF && String.fromCharCode(...b.subarray(p + 1, p + 12)) === 'NETSCAPE2.0') loop = true;
      while (b[p]) p += b[p] + 1; p++;
      continue;
    }
    if (t !== 0x2C) throw new Error('unknown block 0x' + t.toString(16) + ' at ' + (p - 1));
    const fw = b[p + 4] | (b[p + 5] << 8), fh = b[p + 6] | (b[p + 7] << 8); p += 9;
    const min = b[p++], data = [];
    while (b[p]) { data.push(...b.subarray(p + 1, p + 1 + b[p])); p += b[p] + 1; } p++;
    frames.push({ w: fw, h: fh, delay, idx: unlzw(Uint8Array.from(data), min, fw * fh) });
  }
  return { head, w, h, frames, loop, trailer };
}
function unlzw(data, min, n) {
  const clear = 1 << min, eoi = clear + 1, out = [];
  let size = min + 1, dict = [], prev = null, bitPos = 0;
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = []; size = min + 1; prev = null; };
  reset();
  const read = () => { let v = 0; for (let i = 0; i < size; i++, bitPos++) v |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << i; return v; };
  while (bitPos + size <= data.length * 8) {
    const c = read();
    if (c === clear) { reset(); continue; }
    if (c === eoi) break;
    let e;
    if (c < dict.length) { e = dict[c]; if (prev) dict.push([...prev, e[0]]); }
    else { e = [...prev, prev[0]]; dict.push(e); }
    out.push(...e); prev = e;
    if (dict.length === (1 << size) && size < 12) size++;
  }
  assert.equal(out.length, n, 'decoded pixel count');
  return out;
}

test('encodeGif writes GIF89a, a palette, one block per frame, the loop extension and the trailer', () => {
  const W = 7, H = 5, palette = Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const frames = [0, 1, 2].map(s => ({ indices: Uint8Array.from({ length: W * H }, (_, i) => (i + s) % 4), delay: 60 }));
  const g = encodeGif({ width: W, height: H, palette, frames }), r = readGif(g);
  assert.equal(r.head, 'GIF89a');
  assert.equal(g[g.length - 1], 0x3B); assert.ok(r.trailer, 'the trailer is the last byte');
  assert.equal(r.w, W); assert.equal(r.h, H);
  assert.equal(r.frames.length, 3); assert.ok(r.loop);
  r.frames.forEach((f, k) => { assert.equal(f.delay, 60); assert.deepEqual(f.idx, [...frames[k].indices]); });
});

test('LZW round-trips long, noisy data through table resets (more than 4096 codes)', () => {
  let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
  const idx = Uint8Array.from({ length: 200 * 150 }, () => Math.floor(rnd() * 256));
  const g = encodeGif({ width: 200, height: 150, palette: new Uint8Array(768), frames: [{ indices: idx, delay: 0 }] }), r = readGif(g);
  assert.equal(r.frames.length, 1); assert.equal(r.loop, false, 'a still image has no loop block');
  assert.deepEqual(r.frames[0].idx, [...idx]);
  assert.ok(lzw(new Uint8Array(1000), 8).length < 100, 'a flat image compresses');
});

test('gifFromRGBA: two RGBA frames (a dark sky with a moving copper star) keep their colours after the palette', () => {
  const W = 40, H = 30, frame = (sx) => { const px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, d = Math.hypot(x - sx, y - 15), v = Math.max(0, 255 - d * 40);
      px[i] = 20 + v * .9; px[i + 1] = 18 + v * .5; px[i + 2] = 16 + v * .3; px[i + 3] = 255; }
    return px; };
  const fr = [{ px: frame(12), delay: 60 }, { px: frame(28), delay: 60 }];
  const g = gifFromRGBA(W, H, fr), r = readGif(g);
  assert.equal(r.head, 'GIF89a'); assert.equal(r.frames.length, 2); assert.ok(r.trailer);
  const { palette } = buildPalette(fr.map(f => f.px));
  assert.ok(palette.length / 3 <= 256 && palette.length / 3 > 4);
  // every decoded pixel is within a few levels of the original colour
  r.frames.forEach((f, k) => {
    let worst = 0;
    f.idx.forEach((c, i) => { for (let ch = 0; ch < 3; ch++) worst = Math.max(worst, Math.abs(palette[c * 3 + ch] - fr[k].px[i * 4 + ch])); });
    assert.ok(worst <= 12, `worst channel error ${worst}`);
  });
});
