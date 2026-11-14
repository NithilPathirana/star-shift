// Talk to the NASA/IPAC Infrared Science Archive (IRSA) for SPHEREx images.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// In Node we call IRSA directly. In the browser IRSA sends no CORS header, so `base`
// points at our relay (proxy/worker.js), which forwards the same paths.

import { readHDUsFromStream, scanHDUs, readImage } from './fits.js';
import { TanSip } from './wcs.js';

export const IRSA = 'https://irsa.ipac.caltech.edu';

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function getText(url, fetchFn, signal) {
  const res = await fetchFn(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);
  return res.text();
}

export async function tap(adql, { base = IRSA, fetchFn = fetch, signal } = {}) {
  const url = `${base}/TAP/sync?FORMAT=csv&QUERY=${encodeURIComponent(adql)}`;
  const text = await getText(url, fetchFn, signal);
  if (text.trimStart().startsWith('<')) throw new Error('TAP error: ' + text.slice(0, 300));
  return parseCSV(text);
}

const num = (v) => (v === '' || v == null ? null : Number(v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// All SPHEREx spectral images (QR + DR1, as served by IRSA) covering (ra, dec), oldest first.
// detectors: optional list of 1..6.
export async function listImages(ra, dec, { detectors, ...opts } = {}) {
  if (!isNum(ra) || !isNum(dec) || dec < -90 || dec > 90) throw new Error('Bad coordinates');
  const bandFilter = detectors?.length
    ? `AND p.energy_bandpassname IN (${detectors.map(d => `'SPHEREx-D${Number(d)}'`).join(',')})`
    : '';
  const adql = `SELECT a.uri, p.time_bounds_lower, p.time_bounds_upper, p.energy_bandpassname,
      p.energy_bounds_lower, p.energy_bounds_upper, p.obsid, p.quality_flag
    FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
    WHERE 1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly) ${bandFilter}
    ORDER BY p.time_bounds_lower`;
  const rows = await tap(adql.replace(/\s+/g, ' '), opts);
  return rows.map(r => ({
    uri: r.uri,
    mjdStart: num(r.time_bounds_lower),
    mjdEnd: num(r.time_bounds_upper),
    detector: Number(String(r.energy_bandpassname).replace('SPHEREx-D', '')),
    bandMinUm: num(r.energy_bounds_lower) * 1e6 || null,
    bandMaxUm: num(r.energy_bounds_upper) * 1e6 || null,
    obsid: r.obsid,
    quality: r.quality_flag,
  }));
}

export function cutoutUrl(uri, ra, dec, sizeDeg, base = IRSA) {
  if (!/^ibe\/data\/spherex\/[\w./-]+\.fits$/.test(uri)) throw new Error('Unexpected SPHEREx uri: ' + uri);
  return `${base}/${uri}?center=${ra.toFixed(6)},${dec.toFixed(6)}d&size=${sizeDeg}`;
}

// Download a cutout but keep only PRIMARY, IMAGE and FLAGS (stops the download early).
// IRSA's cutout service returns HTTP 503 now and then (seen often on 14 Nov 2026), so retry.
export async function fetchCutout(uri, ra, dec, sizeDeg,
  { base = IRSA, fetchFn = fetch, signal, retries = 5, backoffMs = 1500 } = {}) {
  const url = cutoutUrl(uri, ra, dec, sizeDeg, base);
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, { signal });
    if (res.ok) return decodeCutout(await readHDUsFromStream(res.body, 3));
    res.body?.cancel?.().catch(() => {});
    const retryable = res.status === 503 || res.status === 502 || res.status === 429;
    if (!retryable || attempt >= retries) throw new Error(`HTTP ${res.status} for cutout`);
    await new Promise(r => setTimeout(r, backoffMs * (attempt + 1)));
  }
}

export function decodeCutout(bytes) {
  const { hdus, done } = scanHDUs(bytes, 3);
  if (!done) throw new Error('Cutout file incomplete');
  const imgHdu = hdus.find(h => h.header.EXTNAME === 'IMAGE');
  const flgHdu = hdus.find(h => h.header.EXTNAME === 'FLAGS');
  if (!imgHdu) throw new Error('No IMAGE extension');
  const header = imgHdu.header;
  const image = readImage(bytes, imgHdu);
  const flags = flgHdu ? readImage(bytes, flgHdu) : null;
  return {
    header,
    image,
    flags,
    flagNames: flgHdu ? flagDefinitions(flgHdu.header) : {},
    wcs: new TanSip(header),
    mjd: header['MJD-AVG'] ?? header['MJD-OBS'],
    date: header['DATE-AVG'] ?? header['DATE-OBS'],
    detector: Number(header.DETECTOR),
    obsid: header.OBSID,
    version: hdus[0].header.VERSION ?? null,
  };
}

// Run async jobs with a concurrency limit, reporting each result as it lands.
export async function mapLimit(items, limit, fn, onResult) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { results[i] = { ok: true, value: await fn(items[i], i) }; }
      catch (e) { results[i] = { ok: false, error: e }; }
      onResult?.(results[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// SPHEREx FLAGS headers describe each bit: MSKNnnnn = name, MSKMnnnn = bit value, MSKDnnnn = text.
export function flagDefinitions(h) {
  const out = {};
  for (const k of Object.keys(h)) {
    if (!k.startsWith('MSKN')) continue;
    const i = k.slice(4);
    out[h['MSKM' + i]] = { name: h[k], description: h['MSKD' + i] ?? '' };
  }
  return out;
}

// Flags that mean "don't trust this pixel's value" on empty sky (detector or processing
// problems, cosmic-ray hits). Checked on Barnard's Star (124 cutouts, 14 Nov 2026): its
// brightest pixel is flagged OVERFLOW in 109 and TRANSIENT/SUR_ERROR in 29 - values the
// pipeline rebuilt from early reads - so on pixels marked SOURCE we only drop dead or
// missing data (SOURCE_BAD_FLAGS). Shown as info, never masked: FULLSAMPLE, DICHROIC,
// NONLINEAR, CROSSTALK, GHOST*, STREAK, BLOOM, SNOWBALL, HALO, PHANMISS.
export const BAD_PIXEL_FLAGS = ['TRANSIENT', 'OVERFLOW', 'SUR_ERROR', 'NONFUNC', 'MISSING_DATA', 'HOT', 'COLD', 'PERSIST', 'OUTLIER'];
export const SOURCE_BAD_FLAGS = ['NONFUNC', 'MISSING_DATA'];

export function badPixelMask(flagNames, names = BAD_PIXEL_FLAGS) {
  let m = 0;
  for (const [bit, d] of Object.entries(flagNames)) if (names.includes(d.name)) m |= Number(bit);
  return m;
}

// Copy of the cutout with untrustworthy pixels set to NaN.
export function maskBadPixels(cutout, { names = BAD_PIXEL_FLAGS, sourceNames = SOURCE_BAD_FLAGS } = {}) {
  if (!cutout.flags) return cutout;
  const m = badPixelMask(cutout.flagNames, names);
  const ms = badPixelMask(cutout.flagNames, sourceNames);
  const src = badPixelMask(cutout.flagNames, ['SOURCE']);
  const data = Float32Array.from(cutout.image.data);
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    const f = cutout.flags.data[i];
    if (f & (f & src ? ms : m)) { data[i] = NaN; n++; }
  }
  return { ...cutout, image: { ...cutout.image, data }, maskedPixels: n };
}
