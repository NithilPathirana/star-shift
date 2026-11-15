// Cloudflare Worker: a small read-only relay so the browser can reach IRSA and Gaia,
// which send no CORS headers. It only forwards GET requests to fixed public endpoints,
// and trims SPHEREx cutouts to the parts we use (PRIMARY + IMAGE + FLAGS, or + VARIANCE +
// ZODI with hdus=5), cutting a ~4 MB download to ~55 kB. No secrets, no storage, no user data.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { readHDUsFromStream } from '../web/core/fits.js';
import { hipsRoute, channelProperties, tintPalettePNG, PALETTE_VERSION } from './hips.js';
import { jplRoute } from './jpl.js'; // Codex: allow-listed JPL SSD APIs (cad, sentry, sbdb, sb_ident, horizons)

const IRSA = 'https://irsa.ipac.caltech.edu';
const GAIA = 'https://gea.esac.esa.int/tap-server/tap/sync';
const CUTOUT_PATH = /^\/ibe\/data\/spherex\/[\w./-]+\.fits$/;
// Telescope compare (DESIGN.md 31a): one 2MASS Ks atlas image or one AllWISE W1/W2 atlas
// image per patch, as small cutouts. Exact file-name patterns only; IBE sends these gzipped,
// so the relay unzips them and keeps the first HDU (the image).
export const SURVEY_PATHS = [
  /^\/ibe\/data\/twomass\/allsky\/allsky\/\d{6}[ns]\/s\d{3}\/image\/ki\d{7}\.fits\.gz$/,
  /^\/ibe\/data\/wise\/allwise\/p3am_cdd\/\d{2}\/\d{4}\/\d{4}[pm]\d{3}_ac51\/\d{4}[pm]\d{3}_ac51-w[12]-int-3\.fits$/,
];
const SIA_COLLECTIONS = ['spherex_dr1', 'spherex_qr3', 'twomass_allsky', 'wise_allwise']; // SPHEREx: web/data/releases.json
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function reply(body, status, extra = {}) {
  return new Response(body, { status, headers: { ...CORS, ...extra } });
}

// Strict check of a TAP sync request; returns the ADQL text, or null to refuse.
// The raw query string is forwarded unchanged (so cache keys stay the same), which means
// it must hold exactly what we checked: known parameter names only, each at most once
// (case-insensitive, so QUERY=…&query=… can't smuggle a second query past us), one
// QUERY, no comments, no semicolons, no quoted identifiers, a single SELECT (no
// subqueries/UNION), and every table after FROM / JOIN / a comma must match `tableRe`.
const TAP_PARAMS = new Set(['request', 'lang', 'format', 'query', 'maxrec', 'responseformat']);
export function tapQuery(url, tableRe) {
  const seen = new Map();
  for (const [k, v] of url.searchParams) {
    const key = k.toLowerCase();
    if (!TAP_PARAMS.has(key) || seen.has(key)) return null;
    seen.set(key, v);
  }
  const q = seen.get('query');
  if (!q || q.length > 4000) return null;
  if (seen.has('lang') && !/^ADQL$/i.test(seen.get('lang'))) return null;
  if (seen.has('request') && !/^doQuery$/i.test(seen.get('request'))) return null;
  if (seen.has('format') && !/^(csv|json|votable|tsv)$/i.test(seen.get('format'))) return null;
  if (seen.has('responseformat') && !/^(csv|json|votable|tsv)$/i.test(seen.get('responseformat'))) return null;
  if (seen.has('maxrec') && !/^\d{1,5}$/.test(seen.get('maxrec'))) return null;
  // String literals can hold anything; blank them out before looking at the structure.
  const sql = q.replace(/'(?:[^']|'')*'/g, "''");
  if (/'/.test(sql.replace(/''/g, ''))) return null;                  // unterminated string
  if (/--|\/\*|\*\/|;|"|\\|[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(sql)) return null;
  if (!/^\s*SELECT\b/i.test(sql) || (sql.match(/\bSELECT\b/gi) || []).length !== 1) return null;
  if (/\b(UNION|INTERSECT|EXCEPT|INTO|TAP_UPLOAD)\b/i.test(sql)) return null;
  const from = /\bFROM\b([\s\S]*?)(?=\bWHERE\b|\bORDER\b|\bGROUP\b|\bHAVING\b|\bOFFSET\b|$)/i.exec(sql);
  if (!from || /\bFROM\b/i.test(sql.slice(from.index + 4))) return null;     // exactly one FROM
  let clause = from[1];
  for (let i = 0; i < 10 && /\(/.test(clause); i++) clause = clause.replace(/\([^()]*\)/g, ' ');
  if (/[()]/.test(clause)) return null;
  const tables = clause.split(/,|\bJOIN\b/i).map(part => part.trim().split(/\s+/)[0]);
  if (!tables.length || !tables.every(t => tableRe.test(t))) return null;
  return q;
}

function upstreamFor(url) {
  const p = url.pathname;
  const jpl = jplRoute(url); if (jpl) return jpl;
  const h = hipsRoute(url);
  if (h) return h.error ? { error: h.error } : { ...h, cacheKey: `${h.target}?ch=${h.channel ?? ''}&tint=${h.tint ?? ''}&pal=${h.tint ? PALETTE_VERSION : 0}` };
  if (p === '/TAP/sync') {
    // Only read-only queries on the SPHEREx tables (stops use as a general IRSA relay).
    const q = tapQuery(url, /^spherex\.\w+$/i);
    if (!q) return { error: 'Only SELECT queries on spherex.* tables' };
    return { target: `${IRSA}/TAP/sync${url.search}`, kind: 'tap', ttl: 3600 };
  }
  if (p === '/SIA') {
    const c = url.searchParams.get('COLLECTION') || '', pos = url.searchParams.get('POS') || '';
    if (!SIA_COLLECTIONS.includes(c) || !/^circle [-\d.]+ [-\d.]+ [\d.]+$/.test(pos)) return { error: 'Only SPHEREx, 2MASS or AllWISE SIA position searches' };
    if (!c.startsWith('spherex') && !(Number(pos.split(' ')[3]) <= 0.1)) return { error: 'Search radius too large' };
    return { target: `${IRSA}/SIA?COLLECTION=${c}&POS=${encodeURIComponent(pos).replace(/%20/g, '+')}&RESPONSEFORMAT=VOTABLE`, kind: 'tap', ttl: 86400 };
  }
  if (p === '/gaia/tap/sync') {
    // Small cone searches only: SELECT TOP <=2000 ... FROM gaiadr3.* ... CONTAINS(...)
    const q = tapQuery(url, /^gaiadr3\.\w+$/i);
    const top = q && /^\s*SELECT\s+TOP\s+(\d+)\b/i.exec(q);
    if (!top || Number(top[1]) > 2000 || !/\bCONTAINS\s*\(/i.test(q))
      return { error: 'Only small Gaia DR3 cone searches' };
    return { target: `${GAIA}${url.search}`, kind: 'tap', ttl: 86400 };
  }
  if (CUTOUT_PATH.test(p) && !p.includes('..')) {
    const center = url.searchParams.get('center') || '';
    const size = Number(url.searchParams.get('size'));
    if (!/^-?[\d.]+,-?[\d.]+d?$/.test(center) || !(size >= 0.01 && size <= 0.5)) return { error: 'Bad center/size' };
    // Default: PRIMARY + IMAGE + FLAGS (cache key = the IRSA URL, unchanged). `hdus=5` adds
    // VARIANCE + ZODI for the Layers bar, fetched only when asked, under its own cache key.
    const hdus = url.searchParams.get('hdus');
    if (hdus !== null && hdus !== '5') return { error: 'hdus must be 5' };
    const target = `${IRSA}${p}?center=${center}&size=${size}`;
    if (hdus === '5') return { target, kind: 'cutout', hdus: 5, cacheKey: `${target}&hdus=5`, ttl: 30 * 86400 };
    return { target, kind: 'cutout', ttl: 30 * 86400 };
  }
  if (SURVEY_PATHS.some(re => re.test(p))) {
    const center = url.searchParams.get('center') || '', size = Number(url.searchParams.get('size'));
    if ([...url.searchParams.keys()].some(k => k !== 'center' && k !== 'size')) return { error: 'Only center and size' };
    if (!/^-?\d{1,3}(\.\d{1,8})?,-?\d{1,2}(\.\d{1,8})?$/.test(center) || !(size >= 0.01 && size <= 0.25)) return { error: 'Bad center/size' };
    return { target: `${IRSA}${p}?center=${center}&size=${size}`, kind: 'survey', ttl: 30 * 86400 };
  }
  return { error: 'Not found', status: 404 };
}

// IBE cutouts arrive gzipped (Content-Type application/gzip): unzip when the magic bytes say so.
async function surveyFits(res) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 12 * 1024 * 1024) throw new Error('FITS stream too large');
  const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const stream = new Response(bytes).body;
  return readHDUsFromStream(gz ? stream.pipeThrough(new DecompressionStream('gzip')) : stream, 1);
}

// Options: tapTtl overrides how long TAP answers are cached; staleIfError serves an
// expired cached copy when the archive is down or we're offline (local server uses both).
export async function handle(request, { fetchFn = fetch, cache = globalThis.caches?.default, tapTtl, staleIfError = false } = {}) {
  if (request.method === 'OPTIONS') return reply(null, 204);
  if (request.method !== 'GET') return reply('Method not allowed', 405);
  const url = new URL(request.url);
  if (url.pathname === '/' || url.pathname === '/health') return reply('ok', 200, { 'Content-Type': 'text/plain' });
  const up = upstreamFor(url);
  if (up.error) return reply(up.error, up.status || 400, { 'Content-Type': 'text/plain' });
  if (up.kind === 'tap' && tapTtl) up.ttl = tapTtl;

  const cacheKey = new Request(up.cacheKey || up.target);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const stale = async () => (staleIfError && cache ? cache.match(cacheKey, { ignoreExpiry: true }) : undefined);
  let res;
  try {
    res = await fetchFn(up.target, { headers: { 'User-Agent': 'spherex-relay (NASA Space Apps 2026 project)' } });
  } catch (e) {
    const old = await stale();
    if (old) return old;
    return reply('Archive unreachable (offline?)', 504, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  }
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    const old = await stale();
    if (old) return old;
    // Pass "busy" codes through so the browser retries (IRSA cutouts often return 503).
    const status = [429, 503].includes(res.status) ? res.status : 502;
    return reply(`Upstream HTTP ${res.status}`, status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  }

  let out;
  if (up.kind === 'hips-props') {
    out = reply(channelProperties(await res.text(), up.channel), 200, { 'Content-Type': 'text/plain', 'Cache-Control': `public, max-age=${up.ttl}` });
  } else if (up.kind === 'hips-tile' || up.kind === 'hips-bin') {
    let bytes = new Uint8Array(await res.arrayBuffer());
    if (up.tint) bytes = tintPalettePNG(bytes, up.tint);
    // tinted tiles: short browser cache so palette tweaks show up; the relay's own cache keeps them longer
    out = reply(bytes, 200, { 'Content-Type': up.kind === 'hips-tile' ? 'image/png' : 'application/fits', 'Cache-Control': `public, max-age=${up.tint ? 3600 : up.ttl}` });
  } else if (up.kind === 'cutout') {
    let bytes;
    try {
      bytes = await readHDUsFromStream(res.body, up.hdus || 3);
    } catch (e) {
      // Truncated or broken stream: never cache it. Serve an older copy if we have one,
      // else 503 so the browser retries (it already retries IRSA's own 503s).
      const old = await stale();
      if (old) return old;
      const busy = !/too large/.test(e && e.message);
      return reply(`Upstream cutout incomplete (${e && e.message})`, busy ? 503 : 502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'Retry-After': '2' });
    }
    out = reply(bytes, 200, { 'Content-Type': 'application/fits', 'Cache-Control': `public, max-age=${up.ttl}` });
  } else if (up.kind === 'survey') {
    let bytes;
    try { bytes = await surveyFits(res); } catch (e) {
      const old = await stale();
      if (old) return old;
      return reply(`Upstream cutout incomplete (${e && e.message})`, /too large/.test(e && e.message) ? 502 : 503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'Retry-After': '2' });
    }
    out = reply(bytes, 200, { 'Content-Type': 'application/fits', 'Cache-Control': `public, max-age=${up.ttl}` });
  } else {
    out = reply(await res.text(), 200, {
      'Content-Type': res.headers.get('Content-Type') || 'text/plain',
      'Cache-Control': `public, max-age=${up.ttl}`,
    });
  }
  if (cache) await cache.put(cacheKey, out.clone());
  return out;
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request);
    } catch (e) {
      return reply('Relay error: ' + (e && e.message), 502, { 'Content-Type': 'text/plain' });
    }
  },
};
