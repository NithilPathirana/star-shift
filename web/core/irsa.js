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
export async function fetchCutout(uri, ra, dec, sizeDeg, { base = IRSA, fetchFn = fetch, signal } = {}) {
  const url = cutoutUrl(uri, ra, dec, sizeDeg, base);
  const res = await fetchFn(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for cutout`);
  const bytes = await readHDUsFromStream(res.body, 3);
  return decodeCutout(bytes);
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
