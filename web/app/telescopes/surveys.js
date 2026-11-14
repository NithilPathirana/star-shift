// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Telescope compare (DESIGN.md 31a): find one 2MASS Ks and one AllWISE W1 atlas image of a
// patch with IRSA's SIA service, then fetch a small cutout of it through our relay (which
// unzips IBE's gzip and keeps the image HDU). Polite retries: IRSA often answers 502/503.
import { parseVOTable } from '../../core/irsa.js';
import { scanHDUs, readImage } from '../../core/fits.js';
import { linearWcs, twomassMeta, wiseMeta } from './geometry.js';

// Same exact patterns as the relay (proxy/worker.js SURVEY_PATHS): nothing else is asked for.
export const SURVEYS = {
  wise: { id: 'wise', name: 'AllWISE', collection: 'wise_allwise', where: 'SPACE',
    path: /^\/ibe\/data\/wise\/allwise\/p3am_cdd\/\d{2}\/\d{4}\/\d{4}[pm]\d{3}_ac51\/\d{4}[pm]\d{3}_ac51-w1-int-3\.fits$/ },
  twomass: { id: 'twomass', name: '2MASS', collection: 'twomass_allsky', where: 'GROUND',
    path: /^\/ibe\/data\/twomass\/allsky\/allsky\/\d{6}[ns]\/s\d{3}\/image\/ki\d{7}\.fits\.gz$/ },
};
const IRSA_PREFIX = /^https?:\/\/irsa\.ipac\.caltech\.edu(?=\/)/;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener?.('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
});
const BUSY = new Set([429, 502, 503, 504]);

// GET with up to 4 polite retries (2 s, 5 s, 10 s, 20 s) on "busy" answers and network errors.
async function getRetry(url, { fetchFn = fetch, signal, waits = [2000, 5000, 10000, 20000] } = {}) {
  for (let k = 0; ; k++) {
    let res = null, err = null;
    try { res = await fetchFn(url, { signal }); } catch (e) { if (e?.name === 'AbortError') throw e; err = e; }
    if (res?.ok) return res;
    const text = res ? await res.text().catch(() => '') : '';
    // the relay answers 502 for any upstream failure; a real 4xx/500 upstream is not "busy"
    const busy = !res || (BUSY.has(res.status) && !/Upstream HTTP (4\d\d|500)\b/.test(text));
    if (!busy || k >= waits.length) throw Object.assign(new Error(res ? `HTTP ${res.status}` : String(err?.message || err)), { status: res?.status ?? 0, text });
    await sleep(waits[k], signal);
  }
}

// Candidate images of `survey` that contain (ra, dec), nearest image centre first.
// Returns [] when the archive has none (that is "No image of this patch", not an error).
export async function findImages(survey, ra, dec, { base, fetchFn, signal } = {}) {
  const url = `${base}/SIA?COLLECTION=${survey.collection}&POS=circle+${(+ra).toFixed(6)}+${(+dec).toFixed(6)}+0.001&RESPONSEFORMAT=VOTABLE`;
  const xml = await (await getRetry(url, { fetchFn, signal })).text();
  if (!xml.includes('<VOTABLE')) throw new Error('SIA: not a VOTable');
  return pickImages(parseVOTable(xml), survey, ra, dec);
}

export function pickImages(rows, survey, ra, dec) {
  const out = [];
  for (const r of rows) {
    const raw = Object.values(r).find(v => typeof v === 'string' && IRSA_PREFIX.test(v) && v.includes('/ibe/data/'));
    if (!raw) continue;
    const path = raw.replace(IRSA_PREFIX, '').replace(/\?.*$/, '');
    if (!survey.path.test(path) || out.some(o => o.path === path)) continue;
    const sra = num(r.s_ra), sdec = num(r.s_dec);
    const d = sra != null && sdec != null ? Math.hypot((sra - ra) * Math.cos(dec * Math.PI / 180), sdec - dec) : 99;
    out.push({ path, dist: d, obsId: r.obs_id || null });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

export const cutoutUrl = (base, path, ra, dec, sizeDeg) =>
  `${base}${path}?center=${(+ra).toFixed(6)},${(+dec).toFixed(6)}&size=${Math.min(0.25, Math.max(0.01, +sizeDeg)).toFixed(4)}`;

export function decodeSurvey(bytes, surveyId) {
  const { hdus, done } = scanHDUs(bytes, 1);
  if (!done || !hdus.length) throw new Error('Cutout file incomplete');
  const h = hdus[0].header, image = readImage(bytes, hdus[0]);
  const wcs = linearWcs(h);
  const meta = surveyId === 'twomass' ? twomassMeta(h) : wiseMeta(h);
  return { header: h, image, wcs, meta };
}

// The whole step for one survey: find, then fetch the nearest image that really covers the
// field (IBE answers 500 "Cutout does not overlap image" for a tile edge; then try the next).
export async function loadSurvey(survey, field, { base, fetchFn = fetch, signal } = {}) {
  const sizeDeg = Math.min(0.25, field.sizeArcsec * 1.45 / 3600); // covers the corners at any small twist
  const cands = await findImages(survey, field.ra0, field.dec0, { base, fetchFn, signal });
  if (!cands.length) return { none: true };
  let last = null;
  for (const c of cands.slice(0, 3)) {
    try {
      const res = await getRetry(cutoutUrl(base, c.path, field.ra0, field.dec0, sizeDeg), { fetchFn, signal });
      const out = decodeSurvey(new Uint8Array(await res.arrayBuffer()), survey.id);
      return { ...out, path: c.path };
    } catch (e) { if (e?.name === 'AbortError') throw e; last = e; }
  }
  throw last || new Error('No cutout');
}
