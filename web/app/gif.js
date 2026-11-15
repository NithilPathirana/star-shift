// A small animated-GIF encoder (GIF89a): a median-cut palette (up to 256 colours, shared by every frame)
// and LZW compression. Pure functions, no DOM, so the tests run it in Node. Written for "Save as GIF".
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

// ---- palette: median cut over a 15-bit (5 bits per channel) colour histogram ----
const key15 = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

// frames: array of RGBA Uint8(Clamped)Array, all the same size. Returns { palette: Uint8Array(3*k), lookup }
// where lookup(r, g, b) gives the palette index of the nearest colour (cached per 15-bit colour).
export function buildPalette(frames, maxColours = 256) {
  const hist = new Uint32Array(32768);
  for (const px of frames) {
    const step = Math.max(1, Math.floor(px.length / 4 / 400000)) * 4; // sample very large frames
    for (let i = 0; i < px.length; i += step) hist[key15(px[i], px[i + 1], px[i + 2])]++;
  }
  const cols = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) cols.push(k);
  let boxes = [cols];
  const ch = (k, c) => c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31;
  const range = box => { // widest channel of a box
    let best = 0, span = -1;
    for (let c = 0; c < 3; c++) {
      let lo = 31, hi = 0; for (const k of box) { const v = ch(k, c); if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo > span) { span = hi - lo; best = c; }
    }
    return { c: best, span };
  };
  while (boxes.length < maxColours) {
    // split the box with the most pixels that still has a spread of colours
    let bi = -1, bw = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      let w = 0; for (const k of boxes[i]) w += hist[k];
      if (w > bw) { bw = w; bi = i; }
    }
    if (bi < 0) break;
    const box = boxes[bi], { c } = range(box);
    box.sort((a, b) => ch(a, c) - ch(b, c));
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length; i++) { acc += hist[box[i]]; if (acc >= bw / 2) { cut = Math.min(box.length - 1, Math.max(1, i + 1)); break; } }
    boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
  }
  if (!boxes.length || !boxes[0].length) boxes = [[0]];
  const palette = new Uint8Array(boxes.length * 3);
  boxes.forEach((box, i) => {
    let r = 0, g = 0, b = 0, w = 0;
    for (const k of box) { const n = hist[k] || 1; r += ch(k, 0) * n; g += ch(k, 1) * n; b += ch(k, 2) * n; w += n; }
    palette[i * 3] = Math.round((r / w) * 255 / 31); palette[i * 3 + 1] = Math.round((g / w) * 255 / 31); palette[i * 3 + 2] = Math.round((b / w) * 255 / 31);
  });
  const cache = new Int16Array(32768).fill(-1), n = boxes.length;
  const lookup = (r, g, b) => {
    const k = key15(r, g, b); let v = cache[k];
    if (v >= 0) return v;
    const R = (k >> 10) * 255 / 31, G = ((k >> 5) & 31) * 255 / 31, B = (k & 31) * 255 / 31;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const dr = palette[i * 3] - R, dg = palette[i * 3 + 1] - G, db = palette[i * 3 + 2] - B, d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bd) { bd = d; best = i; }
    }
    cache[k] = best; return best;
  };
  return { palette, lookup };
}

// RGBA pixels -> palette indices
export function indexFrame(px, lookup) {
  const out = new Uint8Array(px.length / 4);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = lookup(px[i], px[i + 1], px[i + 2]);
  return out;
}

// ---- LZW (GIF variant: variable code size up to 12 bits, clear code at 4096) ----
export function lzw(indices, minCodeSize) {
  const out = []; let cur = 0, bits = 0;
  const emit = (code, size) => { cur |= code << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let next = eoi + 1, size = minCodeSize + 1, map = new Map();
  emit(clear, size);
  if (!indices.length) { emit(eoi, size); if (bits) out.push(cur & 255); return Uint8Array.from(out); }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 256 + k, v = map.get(key);
    if (v !== undefined) { prefix = v; continue; }
    emit(prefix, size);
    if (next === 4096) { emit(clear, size); next = eoi + 1; size = minCodeSize + 1; map = new Map(); }
    else { if (next >= (1 << size)) size++; map.set(key, next++); }
    prefix = k;
  }
  emit(prefix, size); emit(eoi, size);
  if (bits > 0) out.push(cur & 255);
  return Uint8Array.from(out);
}

// ---- the file ----
// frames: [{ indices: Uint8Array(width*height), delay: centiseconds }]; palette: Uint8Array(3*k), k <= 256
export function encodeGif({ width, height, palette, frames, loop = true }) {
  if (!(width > 0 && height > 0 && width < 65536 && height < 65536)) throw new Error('bad GIF size');
  const k = palette.length / 3; let bitsPer = 1; while ((1 << bitsPer) < k) bitsPer++; // table size 2^bitsPer
  const tableLen = 1 << bitsPer, parts = [];
  const u16 = v => [v & 255, (v >> 8) & 255];
  parts.push(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...u16(width), ...u16(height), 0x80 | ((bitsPer - 1) << 4) | (bitsPer - 1), 0, 0]));
  const table = new Uint8Array(tableLen * 3); table.set(palette.subarray(0, Math.min(palette.length, tableLen * 3))); parts.push(table);
  if (loop && frames.length > 1) parts.push(Uint8Array.from([0x21, 0xFF, 0x0B, ...'NETSCAPE2.0'.split('').map(c => c.charCodeAt(0)), 0x03, 0x01, 0, 0, 0]));
  const minCode = Math.max(2, bitsPer);
  for (const f of frames) {
    if (f.indices.length !== width * height) throw new Error('frame size does not match the GIF');
    parts.push(Uint8Array.from([0x21, 0xF9, 0x04, 0x04, ...u16(Math.max(0, Math.round(f.delay || 0))), 0, 0])); // disposal 1: keep
    parts.push(Uint8Array.from([0x2C, 0, 0, 0, 0, ...u16(width), ...u16(height), 0, minCode]));
    const data = lzw(f.indices, minCode), blocks = new Uint8Array(data.length + Math.ceil(data.length / 255) + 1);
    let o = 0;
    for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); blocks[o++] = n; blocks.set(data.subarray(i, i + n), o); o += n; }
    blocks[o++] = 0; parts.push(blocks.subarray(0, o));
  }
  parts.push(Uint8Array.from([0x3B]));
  const total = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(total);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// One call for RGBA frames: [{ px: RGBA array, delay }] -> GIF bytes
export function gifFromRGBA(width, height, frames, opts = {}) {
  const { palette, lookup } = buildPalette(frames.map(f => f.px), opts.colours || 256);
  return encodeGif({ width, height, palette, loop: opts.loop !== false, frames: frames.map(f => ({ indices: indexFrame(f.px, lookup), delay: f.delay })) });
}
