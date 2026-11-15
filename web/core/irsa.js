// Talk to the NASA/IPAC Infrared Science Archive (IRSA) for SPHEREx images.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// In Node we call IRSA directly. In the browser IRSA sends no CORS header, so `base`
// points at our relay (proxy/worker.js), which forwards the same paths.

import { readHDUsFromStream, scanHDUs, readImage } from './fits.js';
import { TanSip } from './wcs.js';
import { prebakedFetch } from './prebaked.js'; // the five demo targets answer from web/prebaked/ (Claude)

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

export async function tap(adql, { base = IRSA, fetchFn = prebakedFetch, signal } = {}) {
  const url = `${base}/TAP/sync?FORMAT=csv&QUERY=${encodeURIComponent(adql)}`;
  const text = await getText(url, fetchFn, signal);
  if (text.trimStart().startsWith('<')) throw new Error('TAP error: ' + text.slice(0, 300));
  return parseCSV(text);
}

const num = (v) => (v === '' || v == null ? null : Number(v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// VOTable (TABLEDATA) -> array of row objects. Small, dependency-free, works in Node and browsers.
export function parseVOTable(xml) {
  const fields = [...xml.matchAll(/<FIELD\b[^>]*\bname="([^"]+)"/g)].map(m => m[1]);
  const ent = (v) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const rows = [];
  for (const tr of xml.matchAll(/<TR>([\s\S]*?)<\/TR>/g)) {
    const tds = [...tr[1].matchAll(/<TD>([\s\S]*?)<\/TD>|<TD\s*\/>/g)].map(m => ent(m[1] ?? ''));
    rows.push(Object.fromEntries(fields.map((f, i) => [f, tds[i] ?? ''])));
  }
  return rows;
}

// The SPHEREx releases we ask IRSA for, with their DOIs: web/data/releases.json is the ONE list
// used by the queries below and by every credit line (tests/releases.test.mjs checks the HTML).
let releasesP = null;
export function loadReleases() {
  releasesP ||= (async () => {
    const url = new URL('../data/releases.json', import.meta.url);
    if (url.protocol === 'file:') { const { readFile } = await import('node:fs/promises'); return JSON.parse(await readFile(url, 'utf8')); }
    const res = await globalThis.fetch(url);
    if (!res.ok) throw new Error(`releases.json HTTP ${res.status}`);
    return res.json();
  })().catch((e) => { releasesP = null; throw e; });
  return releasesP;
}
// 'spherex_dr1' -> 'dr1', the folder IRSA puts that release's files in (ibe/data/spherex/dr1/...)
export const releaseFolder = (collection) => String(collection).replace(/^spherex_/, '');
// "NASA SPHEREx via IRSA: DR1 spectral images (DOI 10.26131/IRSA678), QR3 ... (DOI ...)"
export function creditText(releases) {
  return 'NASA SPHEREx via IRSA: ' + releases.map(r => `${r.label} (DOI ${r.doi})`).join(' and ');
}

// SIA answers in ~2.5 s (IRSA TAP took 18-48 s on 14 Nov 2026), and DR1 + QR3 are disjoint,
// so both collections are asked in parallel. But SIA can miss images that TAP lists (seen near
// the north ecliptic pole, R Draconis, 15 Nov 2026): listImagesComplete() merges in TAP.
// IRSA's proxy answers 502 now and then (15 Nov 2026): one quick retry before giving up.
export async function listImagesSIA(ra, dec, { base = IRSA, fetchFn = prebakedFetch, signal } = {}) {
  const releases = await loadReleases();
  const lists = await Promise.all(releases.map(async ({ collection: c }) => {
    const url = `${base}/SIA?COLLECTION=${c}&POS=circle+${(+ra).toFixed(6)}+${(+dec).toFixed(6)}+0.0005&RESPONSEFORMAT=VOTABLE`;
    let res = await fetchFn(url, { signal });
    if (res.status === 502 || res.status === 503) { res.body?.cancel?.().catch(() => {}); await sleep(1000, signal); res = await fetchFn(url, { signal }); }
    if (!res.ok) throw new Error(`SIA HTTP ${res.status}`);
    const xml = await res.text();
    if (!xml.includes('<VOTABLE')) throw new Error('SIA: not a VOTable');
    return parseVOTable(xml);
  }));
  const prefix = /^https?:\/\/irsa\.ipac\.caltech\.edu\//;
  return lists.flat()
    .filter(r => (!r.dataproduct_subtype || r.dataproduct_subtype === 'science') && prefix.test(r.access_url))
    .map(r => ({
      uri: r.access_url.replace(prefix, '').replace(/\?.*$/, ''),
      mjdStart: num(r.t_min), mjdEnd: num(r.t_max),
      detector: Number(String(r.energy_bandpassname).replace('SPHEREx-D', '')),
      bandMinUm: num(r.em_min) * 1e6 || null, bandMaxUm: num(r.em_max) * 1e6 || null,
      obsid: r.obs_id, quality: null,
    }))
    .sort((a, b) => a.mjdStart - b.mjdStart);
}

// All SPHEREx spectral images (QR + DR1, as served by IRSA) covering (ra, dec), oldest first.
// detectors: optional list of 1..6. Uses SIA (fast) and falls back to TAP if SIA fails.
export async function listImages(ra, dec, { detectors, ...opts } = {}) {
  if (!isNum(ra) || !isNum(dec) || dec < -90 || dec > 90) throw new Error('Bad coordinates');
  if (opts.useTap !== true) {
    try {
      const all = await listImagesSIA(ra, dec, opts);
      return detectors?.length ? all.filter(im => detectors.map(Number).includes(im.detector)) : all;
    } catch (e) {
      if (e.name === 'AbortError') throw e; // otherwise fall through to TAP
    }
  }
  return listImagesTAP(ra, dec, { detectors, ...opts });
}

export async function listImagesTAP(ra, dec, { detectors, ...opts } = {}) {
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

// Wait `ms`, but stop at once (AbortError) when the load is cancelled.
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(t); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

// Download a cutout but keep only PRIMARY, IMAGE and FLAGS (stops the download early).
// IRSA's cutout service returns HTTP 503 now and then (seen often on 14 Nov 2026), so retry.
export async function fetchCutout(uri, ra, dec, sizeDeg,
  { base = IRSA, fetchFn = prebakedFetch, signal, retries = 5, backoffMs = 1500 } = {}) {
  const url = cutoutUrl(uri, ra, dec, sizeDeg, base);
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, { signal });
    if (res.ok) {
      // A body that breaks off mid-file is retried like a 503 (never decoded half-read).
      try { return decodeCutout(await readHDUsFromStream(res.body, 3)); } catch (e) {
        if (!(e?.retryable || e?.name === 'TypeError') || signal?.aborted || attempt >= retries) throw e;
        await sleep(backoffMs * (attempt + 1), signal);
        continue;
      }
    }
    res.body?.cancel?.().catch(() => {});
    const retryable = res.status === 503 || res.status === 502 || res.status === 429;
    if (!retryable || attempt >= retries) throw new Error(`HTTP ${res.status} for cutout`);
    await sleep(backoffMs * (attempt + 1), signal);
  }
}

// Same cutout with VARIANCE and ZODI too (5 HDUs; still stops before the huge EPSF table).
// Asked for only when the user opens the VARIANCE or ZODI layer; the relay caches it separately.
export async function fetchCutoutLayers(uri, ra, dec, sizeDeg,
  { base = IRSA, fetchFn = prebakedFetch, signal, retries = 3, backoffMs = 1500 } = {}) {
  const url = cutoutUrl(uri, ra, dec, sizeDeg, base) + (base === IRSA ? '' : '&hdus=5');
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, { signal });
    if (res.ok) {
      // A body that breaks off mid-file is retried like a 503 (never decoded half-read).
      try { return decodeCutout(await readHDUsFromStream(res.body, 5), 5); } catch (e) {
        if (!(e?.retryable || e?.name === 'TypeError') || signal?.aborted || attempt >= retries) throw e;
        await sleep(backoffMs * (attempt + 1), signal);
        continue;
      }
    }
    res.body?.cancel?.().catch(() => {});
    const retryable = res.status === 503 || res.status === 502 || res.status === 429;
    if (!retryable || attempt >= retries) throw new Error(`HTTP ${res.status} for cutout layers`);
    await sleep(backoffMs * (attempt + 1), signal);
  }
}

export function decodeCutout(bytes, nHdus = 3) {
  const { hdus, done } = scanHDUs(bytes, nHdus);
  if (!done) throw Object.assign(new Error('Cutout file incomplete'), { retryable: true });
  const imgHdu = hdus.find(h => h.header.EXTNAME === 'IMAGE');
  const flgHdu = hdus.find(h => h.header.EXTNAME === 'FLAGS');
  if (!imgHdu) throw new Error('No IMAGE extension');
  const header = imgHdu.header;
  const image = readImage(bytes, imgHdu);
  const flags = flgHdu ? readImage(bytes, flgHdu) : null;
  const varHdu = hdus.find(h => h.header.EXTNAME === 'VARIANCE'), zodiHdu = hdus.find(h => h.header.EXTNAME === 'ZODI');
  return {
    header,
    image,
    flags,
    flagNames: flgHdu ? flagDefinitions(flgHdu.header) : {},
    variance: varHdu ? readImage(bytes, varHdu) : null,
    zodi: zodiHdu ? readImage(bytes, zodiHdu) : null,
    units: { image: header.BUNIT ?? null, variance: varHdu?.header.BUNIT ?? null, zodi: zodiHdu?.header.BUNIT ?? null },
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
