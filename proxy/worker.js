// Cloudflare Worker: a small read-only relay so the browser can reach IRSA and Gaia,
// which send no CORS headers. It only forwards GET requests to fixed public endpoints,
// and trims SPHEREx cutouts to the parts we use (PRIMARY + IMAGE + FLAGS), cutting a
// ~4 MB download to ~55 kB. No secrets, no storage, no user data.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { readHDUsFromStream } from '../web/core/fits.js';

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
  if (p === '/TAP/sync') {
    const q = url.searchParams.get('QUERY') || '';
    if (!/^\s*SELECT\b/i.test(q) || q.length > 4000) return { error: 'Only SELECT queries' };
    return { target: `${IRSA}/TAP/sync${url.search}`, kind: 'tap', ttl: 3600 };
  }
  if (p === '/gaia/tap/sync') {
    const q = url.searchParams.get('QUERY') || '';
    if (!/^\s*SELECT\b/i.test(q) || q.length > 4000) return { error: 'Only SELECT queries' };
    return { target: `${GAIA}${url.search}`, kind: 'tap', ttl: 86400 };
  }
  if (CUTOUT_PATH.test(p) && !p.includes('..')) {
    const center = url.searchParams.get('center') || '';
    const size = Number(url.searchParams.get('size'));
    if (!/^-?[\d.]+,-?[\d.]+d?$/.test(center) || !(size > 0 && size <= 0.5)) return { error: 'Bad center/size' };
    return { target: `${IRSA}${p}?center=${center}&size=${size}`, kind: 'cutout', ttl: 30 * 86400 };
  }
  return { error: 'Not found', status: 404 };
}

export async function handle(request, { fetchFn = fetch, cache = globalThis.caches?.default } = {}) {
  if (request.method === 'OPTIONS') return reply(null, 204);
  if (request.method !== 'GET') return reply('Method not allowed', 405);
  const url = new URL(request.url);
  if (url.pathname === '/' || url.pathname === '/health') return reply('ok', 200, { 'Content-Type': 'text/plain' });
  const up = upstreamFor(url);
  if (up.error) return reply(up.error, up.status || 400, { 'Content-Type': 'text/plain' });

  const cacheKey = new Request(up.target);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const res = await fetchFn(up.target, { headers: { 'User-Agent': 'spherex-relay (NASA Space Apps 2026 project)' } });
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    // Pass "busy" codes through so the browser retries (IRSA cutouts often return 503).
    const status = [429, 503].includes(res.status) ? res.status : 502;
    return reply(`Upstream HTTP ${res.status}`, status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  }

  let out;
  if (up.kind === 'cutout') {
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
