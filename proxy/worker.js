// Cloudflare Worker: a small read-only relay so the browser can reach IRSA and Gaia,
// which send no CORS headers. It only forwards GET requests to fixed public endpoints,
// and trims SPHEREx cutouts to the parts we use (PRIMARY + IMAGE + FLAGS), cutting a
// ~4 MB download to ~55 kB. No secrets, no storage, no user data.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { readHDUsFromStream } from '../web/core/fits.js';
import { hipsRoute, channelProperties, tintPalettePNG, PALETTE_VERSION } from './hips.js';

const IRSA = 'https://irsa.ipac.caltech.edu';
const GAIA = 'https://gea.esac.esa.int/tap-server/tap/sync';
const CUTOUT_PATH = /^\/ibe\/data\/spherex\/[\w./-]+\.fits$/;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function reply(body, status, extra = {}) {
  return new Response(body, { status, headers: { ...CORS, ...extra } });
}

function upstreamFor(url) {
  const p = url.pathname;
  const h = hipsRoute(url);
  if (h) return h.error ? { error: h.error } : { ...h, cacheKey: `${h.target}?ch=${h.channel ?? ''}&tint=${h.tint ?? ''}&pal=${h.tint ? PALETTE_VERSION : 0}` };
  if (p === '/TAP/sync') {
    const q = url.searchParams.get('QUERY') || '';
    // Only read-only queries on the SPHEREx tables (stops use as a general IRSA relay).
    if (!/^\s*SELECT\b/i.test(q) || !/\bspherex\.\w+/i.test(q) || q.length > 4000)
      return { error: 'Only SELECT queries on spherex.* tables' };
    return { target: `${IRSA}/TAP/sync${url.search}`, kind: 'tap', ttl: 3600 };
  }
  if (p === '/gaia/tap/sync') {
    const q = url.searchParams.get('QUERY') || '';
    // Small cone searches only: SELECT TOP <=2000 ... gaiadr3.* ... CONTAINS(...)
    const top = /^\s*SELECT\s+TOP\s+(\d+)\b/i.exec(q);
    if (!top || Number(top[1]) > 2000 || !/\bgaiadr3\.\w+/i.test(q) || !/\bCONTAINS\s*\(/i.test(q) || q.length > 4000)
      return { error: 'Only small Gaia DR3 cone searches' };
    return { target: `${GAIA}${url.search}`, kind: 'tap', ttl: 86400 };
  }
  if (CUTOUT_PATH.test(p) && !p.includes('..')) {
    const center = url.searchParams.get('center') || '';
    const size = Number(url.searchParams.get('size'));
    if (!/^-?[\d.]+,-?[\d.]+d?$/.test(center) || !(size >= 0.01 && size <= 0.5)) return { error: 'Bad center/size' };
    return { target: `${IRSA}${p}?center=${center}&size=${size}`, kind: 'cutout', ttl: 30 * 86400 };
  }
  return { error: 'Not found', status: 404 };
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
    const bytes = await readHDUsFromStream(res.body, 3);
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
