// SPHEREx all-sky HiPS map, one wavelength channel at a time.
// IRSA publishes the SPHEREx DR1 map as a 102-channel HiPS *cube*
// (https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube). Viewers handle
// cube slices unevenly, so the relay exposes each channel as a plain HiPS at
// /hips/spherex/<channel>/... and can tint a channel to any colour by rewriting the PNG
// palette (the tiles are 8-bit palette PNGs, so no pixel decoding is needed).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

export const HIPS_BASE = 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube';

// Channel centre wavelengths (µm), from the HiPS properties (data_cube_crval3_arr).
export const CHANNEL_UM = [0.753, 0.771, 0.790, 0.809, 0.828, 0.848, 0.868, 0.889, 0.910, 0.932, 0.955, 0.978, 1.001, 1.025, 1.050, 1.075, 1.102, 1.113, 1.139, 1.167, 1.195, 1.224, 1.254, 1.284, 1.315, 1.346, 1.378, 1.412, 1.446, 1.481, 1.517, 1.554, 1.592, 1.631, 1.656, 1.695, 1.735, 1.775, 1.818, 1.861, 1.905, 1.949, 1.995, 2.041, 2.089, 2.139, 2.189, 2.240, 2.292, 2.345, 2.399, 2.445, 2.506, 2.575, 2.646, 2.719, 2.794, 2.871, 2.951, 3.033, 3.118, 3.204, 3.293, 3.383, 3.476, 3.570, 3.667, 3.768, 3.833, 3.867, 3.901, 3.935, 3.970, 4.005, 4.040, 4.076, 4.112, 4.148, 4.184, 4.220, 4.257, 4.294, 4.331, 4.368, 4.405, 4.435, 4.467, 4.500, 4.533, 4.566, 4.600, 4.635, 4.669, 4.704, 4.739, 4.773, 4.808, 4.843, 4.879, 4.915, 4.951, 4.988];
// Channels with no tiles on IRSA (checked 14 Nov 2026): use the nearest real one.
const MISSING = { 50: 49, 51: 52 };
export function realChannel(ch) { return MISSING[ch] ?? ch; }

const ROUTE = /^\/hips\/spherex\/(\d{1,3})(?:\/t\/([0-9a-fA-F]{6}))?\/(properties|Moc\.fits|Norder3\/Allsky\.png|Norder(\d)\/Dir(\d+)\/Npix(\d+)\.png)$/;

// -> { target, kind: 'hips-props'|'hips-bin'|'hips-tile', channel, tint } or null
export function hipsRoute(url) {
  const m = ROUTE.exec(url.pathname);
  if (!m) return null;
  const ch = Number(m[1]);
  if (!(ch >= 0 && ch < CHANNEL_UM.length)) return { error: 'No such channel' };
  const tint = m[2] ? m[2].toLowerCase() : null; // /hips/spherex/<ch>/t/<rrggbb>/... (viewers append tile paths)
  const real = realChannel(ch);
  const suffix = real === 0 ? '' : `_${real}`;
  if (m[3] === 'properties') return { kind: 'hips-props', target: `${HIPS_BASE}/properties`, channel: ch, ttl: 86400 };
  if (m[3] === 'Moc.fits') return { kind: 'hips-bin', target: `${HIPS_BASE}/Moc.fits`, ttl: 7 * 86400 };
  if (m[3] === 'Norder3/Allsky.png') return { kind: 'hips-tile', target: `${HIPS_BASE}/Norder3/Allsky${suffix}.png`, tint, ttl: 30 * 86400 };
  const order = Number(m[4]), dir = Number(m[5]), npix = Number(m[6]);
  if (order > 5 || npix >= 12 * 4 ** order || dir !== Math.floor(npix / 10000) * 10000) return { error: 'Bad tile' };
  return { kind: 'hips-tile', target: `${HIPS_BASE}/Norder${order}/Dir${dir}/Npix${npix}${suffix}.png`, tint, ttl: 30 * 86400 };
}

// Single-channel properties file (cube keywords removed) so any HiPS viewer treats it as an image.
export function channelProperties(text, ch) {
  const keep = text.split(/\r?\n/).filter(l => !/^\s*(dataproduct_type|hips_cube_|data_cube_|custom_tile_format|hips_service_url|hips_progenitor_url|obs_title|creator_did)/.test(l));
  keep.push(`dataproduct_type     = image`, `obs_title            = SPHEREx DR1 ${CHANNEL_UM[ch].toFixed(3)} um (channel ${ch})`,
    `creator_did          = ivo://IPAC/P/SPHEREx/DR1/cube/channel${ch}`, `em_min               = ${(CHANNEL_UM[ch] * 1e-6).toExponential(4)}`);
  return keep.join('\n') + '\n';
}

// ---- PNG palette tint -------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Multiply every palette entry's brightness by the tint colour. Returns a new PNG, or the
// input unchanged if it isn't a palette PNG.
const BLACK = 0.16;
export const PALETTE_VERSION = 2; // bump when the tint curve changes (new cache keys)
export function tintPalettePNG(png, hex) {
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const out = Uint8Array.from(png);
  const view = new DataView(out.buffer);
  let pos = 8;
  while (pos + 12 <= out.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(out[pos + 4], out[pos + 5], out[pos + 6], out[pos + 7]);
    if (type === 'PLTE') {
      const d = pos + 8;
      for (let i = 0; i < len; i += 3) {
        const raw = (0.299 * out[d + i] + 0.587 * out[d + i + 1] + 0.114 * out[d + i + 2]) / 255;
        // raise the black point so faint sky noise doesn't add up to grey when bands are combined
        const lum = Math.pow(Math.min(1, Math.max(0, (raw - BLACK) / (1 - BLACK))), 1.15);
        out[d + i] = Math.round(lum * r); out[d + i + 1] = Math.round(lum * g); out[d + i + 2] = Math.round(lum * b);
      }
      view.setUint32(d + len, crc32(out.subarray(pos + 4, d + len)));
      return out;
    }
    if (type === 'IDAT' || type === 'IEND') break;
    pos += 12 + len;
  }
  return png;
}
