// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Telescope compare (DESIGN.md 31a): find one 2MASS Ks and one AllWISE W1 atlas image of a
// patch with IRSA's SIA service, then fetch a small cutout of it through our relay (which
// unzips IBE's gzip and keeps the image HDU). Polite retries: IRSA often answers 502/503.
import { parseVOTable } from '../../core/irsa.js';
import { scanHDUs, readImage } from '../../core/fits.js';
import { linearWcs, twomassMeta, wiseMeta } from './geometry.js';
import { tanProject, tanDeproject } from '../../core/wcs.js';
// Barnard's 'See 25 years' requests are saved in web/prebaked/ (tools/prebake_telescopes.mjs): exact matches only
import { prebakedFetch } from '../../core/prebaked.js';

// Same exact patterns as the relay (proxy/worker.js SURVEY_PATHS): nothing else is asked for.
export const SURVEYS = {
  wise: { id: 'wise', name: 'AllWISE', collection: 'wise_allwise', where: 'SPACE',
    path: /^\/ibe\/data\/wise\/allwise\/p3am_cdd\/\d{2}\/\d{4}\/\d{4}[pm]\d{3}_ac51\/\d{4}[pm]\d{3}_ac51-w1-int-3\.fits$/ },
  twomass: { id: 'twomass', name: '2MASS', collection: 'twomass_allsky', where: 'GROUND', mosaic: true,
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
// onBusy(status) is told about each busy answer before the wait, so the page can say so at once.
export async function getRetry(url, { fetchFn = fetch, signal, waits = [2000, 5000, 10000, 20000], onBusy } = {}) {
  for (let k = 0; ; k++) {
    let res = null, err = null;
    try { res = await fetchFn(url, { signal }); } catch (e) { if (e?.name === 'AbortError') throw e; err = e; }
    if (res?.ok) return res;
    const text = res ? await res.text().catch(() => '') : '';
    // the relay answers 502 for any upstream failure; a real 4xx/500 upstream is not "busy"
    const busy = !res || (BUSY.has(res.status) && !/Upstream HTTP (4\d\d|500)\b/.test(text));
    if (!busy || k >= waits.length) throw Object.assign(new Error(res ? `HTTP ${res.status}` : String(err?.message || err)), { status: res?.status ?? 0, text });
    onBusy?.(res?.status ?? 0);
    await sleep(waits[k], signal);
  }
}

// Candidate images of `survey` that contain (ra, dec), nearest image centre first.
// Returns [] when the archive has none (that is "No image of this patch", not an error).
export async function findImages(survey, ra, dec, { base, fetchFn, signal, radius = 0.001, onBusy } = {}) {
  const url = `${base}/SIA?COLLECTION=${survey.collection}&POS=circle+${(+ra).toFixed(6)}+${(+dec).toFixed(6)}+${(+radius).toFixed(4)}&RESPONSEFORMAT=VOTABLE`;
  const xml = await (await getRetry(url, { fetchFn, signal, onBusy })).text();
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
    // 2MASS: tiles of one scan share one night; the footprint and start time come with the row
    const scan = /\/(\d{6}[ns]\/s\d{3})\//.exec(path)?.[1] || path;
    out.push({ path, dist: d, obsId: r.obs_id || null, scan, mjd: num(r.t_min), region: parsePolygon(r.s_region) });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

// "POLYGON ICRS ra1 dec1 ra2 dec2 ..." -> [[ra, dec], ...] (closing vertex dropped); null if absent
export function parsePolygon(s) {
  const n = String(s || '').replace(/^\s*POLYGON\s+(ICRS\s+)?/i, '').trim().split(/\s+/).map(Number);
  if (!/^\s*POLYGON/i.test(String(s || '')) || n.length < 6 || n.some(v => !Number.isFinite(v))) return null;
  const v = []; for (let i = 0; i + 1 < n.length; i += 2) v.push([n[i], n[i + 1]]);
  const [a, b] = [v[0], v[v.length - 1]]; if (v.length > 3 && a[0] === b[0] && a[1] === b[1]) v.pop();
  return v;
}
// How far (arcsec) a sky point lies inside a footprint polygon: > 0 inside, < 0 outside.
export function insideArcsec(poly, ra, dec) {
  const P = poly.map(([r, d]) => tanProject(r, d, ra, dec).map(x => x * 3600));
  let inside = false, best = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > 0) !== (yj > 0) && 0 < xi + (0 - yi) * (xj - xi) / (yj - yi)) inside = !inside;
    const dx = xj - xi, dy = yj - yi, t = Math.max(0, Math.min(1, -(xi * dx + yi * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(xi + t * dx, yi + t * dy));
  }
  return inside ? best : -best;
}

// 2MASS tiles are only 8.5′ × 17′, so a field can straddle two tiles of one scan. Rank the scans
// that touch the field: first those with a tile that holds the target ring at that scan's own
// date (at least 12″ inside, the ring is 10″), then by how much of the field their tiles cover.
export function rankScans(cands, field, ringAt) {
  const groups = new Map();
  for (const c of cands) if (c.region) (groups.get(c.scan) || groups.set(c.scan, []).get(c.scan)).push(c);
  const half = field.sizeArcsec / 2, pts = [];
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) pts.push(tanDeproject((-half + i * half / 4) / 3600, (-half + j * half / 4) / 3600, field.ra0, field.dec0));
  const out = [];
  for (const [scan, tiles] of groups) {
    const mjd = tiles.find(t => Number.isFinite(t.mjd))?.mjd ?? null, ring = ringAt?.(mjd) || null;
    const ringIn = ring ? Math.max(...tiles.map(t => insideArcsec(t.region, ring.ra, ring.dec))) : -Infinity;
    const hits = tiles.map(t => pts.filter(([r, d]) => insideArcsec(t.region, r, d) > 0).length);
    const cover = pts.filter(([r, d]) => tiles.some(t => insideArcsec(t.region, r, d) > 0)).length / pts.length;
    // tiles worth fetching: the ring's tile first, then the others that add field coverage
    const use = tiles.map((t, k) => ({ t, k, ring: ring ? insideArcsec(t.region, ring.ra, ring.dec) : -Infinity }))
      .filter(o => o.ring > 0 || hits[o.k] > 0).sort((a, b) => b.ring - a.ring || hits[b.k] - hits[a.k]).slice(0, 3).map(o => o.t);
    out.push({ scan, mjd, ringOk: ringIn >= 12, cover, tiles: use, dist: Math.min(...tiles.map(t => t.dist)) });
  }
  return out.filter(g => g.tiles.length).sort((a, b) => (b.ringOk - a.ringOk) || (b.cover - a.cover) || (a.dist - b.dist));
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
export async function loadSurvey(survey, field, { base, fetchFn = prebakedFetch, signal, ringAt = null, onBusy } = {}) {
  const sizeDeg = Math.min(0.25, field.sizeArcsec * 1.45 / 3600); // covers the corners at any small twist
  if (survey.mosaic) {
    const r = await loadMosaic(survey, field, sizeDeg, { base, fetchFn, signal, ringAt, onBusy });
    if (r) return r;
  }
  const cands = await findImages(survey, field.ra0, field.dec0, { base, fetchFn, signal, onBusy });
  if (!cands.length) return { none: true };
  let last = null;
  for (const c of cands.slice(0, 3)) {
    try {
      const res = await getRetry(cutoutUrl(base, c.path, field.ra0, field.dec0, sizeDeg), { fetchFn, signal, onBusy });
      const out = decodeSurvey(new Uint8Array(await res.arrayBuffer()), survey.id);
      return { ...out, path: c.path };
    } catch (e) { if (e?.name === 'AbortError') throw e; last = e; }
  }
  throw last || new Error('No cutout');
}

// 2MASS: every tile of the best scan that the field needs (one night, so one date), each kept in
// its own pixels with its own WCS. Null when the archive gives no footprints (then: nearest tile).
async function loadMosaic(survey, field, sizeDeg, { base, fetchFn, signal, ringAt, onBusy }) {
  const radius = Math.min(0.1, field.sizeArcsec * Math.SQRT1_2 / 3600);
  const cands = await findImages(survey, field.ra0, field.dec0, { base, fetchFn, signal, radius, onBusy });
  if (!cands.length) return { none: true };
  let last = null;
  for (const g of rankScans(cands, field, ringAt).slice(0, 2)) {
    const pieces = [];
    for (const c of g.tiles) {
      try {
        const res = await getRetry(cutoutUrl(base, c.path, field.ra0, field.dec0, sizeDeg), { fetchFn, signal, onBusy });
        pieces.push({ ...decodeSurvey(new Uint8Array(await res.arrayBuffer()), survey.id), path: c.path });
      } catch (e) { if (e?.name === 'AbortError') throw e; last = e; }
    }
    if (pieces.length) return { ...pieces[0], pieces };
  }
  if (last) throw last;
  return null;
}
