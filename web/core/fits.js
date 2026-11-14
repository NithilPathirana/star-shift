// Minimal FITS reader for SPHEREx cutouts (images + headers only).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// SPHEREx cutout files hold PRIMARY, IMAGE, FLAGS, VARIANCE, ZODI, EPSF, WCS-WAVE.
// The EPSF table is ~99% of the bytes, so we read only the first HDUs we need and
// stop. `scanHDUs` works on a partial buffer so a stream can be cut short.

const BLOCK = 2880;
const CARD = 80;

function ascii(bytes, start, len) {
  let s = '';
  for (let i = start; i < start + len; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export function parseValue(raw) {
  const s = raw.trimStart();
  if (s.startsWith("'")) {
    let out = '';
    for (let i = 1; i < s.length; i++) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") { out += "'"; i++; continue; }
        break;
      }
      out += s[i];
    }
    return out.trimEnd();
  }
  const v = s.split('/')[0].trim();
  if (v === 'T') return true;
  if (v === 'F') return false;
  if (v === '') return null;
  const n = Number(v.replace(/[dD]/, 'e'));
  return Number.isNaN(n) ? v : n;
}

// Parse one header starting at `offset`. Returns null if the END card is not in `bytes` yet.
export function parseHeader(bytes, offset) {
  const header = {};
  let pos = offset;
  while (pos + CARD <= bytes.length) {
    const card = ascii(bytes, pos, CARD);
    pos += CARD;
    const key = card.slice(0, 8).trim();
    if (key === 'END') {
      const size = Math.ceil((pos - offset) / BLOCK) * BLOCK;
      return { header, headerBytes: size };
    }
    if (card.slice(8, 10) === '= ' && key) header[key] = parseValue(card.slice(10));
    else if (key === 'HIERARCH') { // long keywords, e.g. HIERARCH HE_AIRGLOW_CONT = 0.12
      const m = /^HIERARCH\s+(.+?)\s*=(.*)$/.exec(card);
      if (m) header[m[1]] = parseValue(m[2]);
    }
  }
  return null;
}

export function dataBytes(h) {
  const naxis = h.NAXIS || 0;
  if (naxis === 0) return 0;
  let n = 1;
  for (let i = 1; i <= naxis; i++) n *= h['NAXIS' + i];
  const raw = (Math.abs(h.BITPIX) / 8) * (h.GCOUNT ?? 1) * ((h.PCOUNT ?? 0) + n);
  return Math.ceil(raw / BLOCK) * BLOCK;
}

// Find HDU boundaries in a (possibly partial) buffer.
// Returns { hdus: [{header, start, dataStart, end}], done } where `done` means the
// first `maxHDUs` HDUs are complete inside `bytes`.
export function scanHDUs(bytes, maxHDUs = Infinity) {
  const hdus = [];
  let pos = 0;
  while (hdus.length < maxHDUs && pos < bytes.length) {
    const parsed = parseHeader(bytes, pos);
    if (!parsed) break;
    const dataStart = pos + parsed.headerBytes;
    const end = dataStart + dataBytes(parsed.header);
    if (end > bytes.length) break;
    hdus.push({ header: parsed.header, start: pos, dataStart, end });
    pos = end;
  }
  return { hdus, done: hdus.length >= maxHDUs, bytesUsed: pos };
}

export function readImage(bytes, hdu) {
  const h = hdu.header;
  const nx = h.NAXIS1, ny = h.NAXIS2, n = nx * ny;
  const view = new DataView(bytes.buffer, bytes.byteOffset + hdu.dataStart, n * Math.abs(h.BITPIX) / 8);
  const bscale = h.BSCALE ?? 1, bzero = h.BZERO ?? 0;
  let out;
  switch (h.BITPIX) {
    case -32: out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = view.getFloat32(i * 4); break;
    case -64: out = new Float64Array(n); for (let i = 0; i < n; i++) out[i] = view.getFloat64(i * 8); break;
    case 32: out = new Int32Array(n); for (let i = 0; i < n; i++) out[i] = view.getInt32(i * 4); break;
    case 16: out = new Int32Array(n); for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2); break;
    default: throw new Error('Unsupported BITPIX ' + h.BITPIX);
  }
  if (bscale !== 1 || bzero !== 0) {
    const f = new Float64Array(n);
    for (let i = 0; i < n; i++) f[i] = out[i] * bscale + bzero;
    out = f;
  }
  return { nx, ny, data: out }; // row-major, row 0 = FITS y=1 (bottom)
}

// Read a stream until the first `maxHDUs` HDUs are complete, then cancel it.
// Returns a Uint8Array holding exactly those HDUs.
// Linear time: the buffer grows by doubling, and each HDU header is parsed once
// (keeps CPU low on the Cloudflare free plan). maxBytes guards against huge inputs.
export async function readHDUsFromStream(stream, maxHDUs, maxBytes = 8 * 1024 * 1024) {
  const reader = stream.getReader();
  let buf = new Uint8Array(64 * 1024);
  let len = 0, pos = 0, count = 0, pendingEnd = -1;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) {
        if (len + value.length > maxBytes) throw new Error('FITS stream too large');
        if (len + value.length > buf.length) {
          const next = new Uint8Array(Math.max(buf.length * 2, len + value.length));
          next.set(buf.subarray(0, len));
          buf = next;
        }
        buf.set(value, len);
        len += value.length;
      }
      // Advance over every HDU that is now complete.
      for (;;) {
        if (pendingEnd < 0) {
          const parsed = parseHeader(buf.subarray(0, len), pos);
          if (!parsed) break;
          pendingEnd = pos + parsed.headerBytes + dataBytes(parsed.header);
        }
        if (pendingEnd > len) break;
        pos = pendingEnd; pendingEnd = -1; count++;
        if (count >= maxHDUs) return buf.slice(0, pos);
      }
      if (done) return buf.slice(0, pos);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
