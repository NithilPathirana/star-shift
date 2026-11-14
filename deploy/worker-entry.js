// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026.
// Cloudflare Workers entry: static assets first, approved read-only relays second.

import { handle as relayHandle } from '../proxy/worker.js';
import { jplRoute } from '../proxy/jpl.js';

const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
});

const JPL_PATHS = new Set([
  '/jpl/cad',
  '/jpl/sentry',
  '/jpl/sbdb',
  '/jpl/sb_ident',
  '/jpl/horizons',
]);

function textResponse(body, status, extra = {}) {
  return new Response(body, {
    status,
    headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', ...extra },
  });
}

export function isRelayPath(pathname) {
  return pathname === '/health'
    || pathname === '/TAP/sync'
    || pathname === '/SIA'
    || pathname === '/gaia/tap/sync'
    || pathname.startsWith('/ibe/data/spherex/')
    || pathname.startsWith('/hips/spherex/')
    || JPL_PATHS.has(pathname);
}

export async function handleJpl(request, {
  fetchFn = fetch,
  cache = globalThis.caches?.default,
  waitUntil,
} = {}) {
  if (request.method === 'OPTIONS') return textResponse(null, 204);
  if (request.method !== 'GET') return textResponse('Method not allowed', 405);

  const route = jplRoute(new URL(request.url));
  if (!route) return textResponse('Bad or unsupported JPL query', 400);

  const cacheKey = new Request(route.target);
  const cached = cache ? await cache.match(cacheKey) : undefined;
  if (cached) return cached;

  let upstream;
  try {
    upstream = await fetchFn(route.target, {
      headers: { 'User-Agent': 'star-shift-relay (NASA Space Apps 2026 project)' },
    });
  } catch {
    return textResponse('JPL is unreachable', 504, { 'Cache-Control': 'no-store' });
  }

  if (!upstream.ok) {
    upstream.body?.cancel?.().catch(() => {});
    const status = [429, 503].includes(upstream.status) ? upstream.status : 502;
    return textResponse(`JPL HTTP ${upstream.status}`, status, { 'Cache-Control': 'no-store' });
  }

  const response = new Response(upstream.body, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      'Cache-Control': `public, max-age=${route.ttl}`,
    },
  });

  if (cache) {
    const write = cache.put(cacheKey, response.clone()).catch(() => {});
    if (waitUntil) waitUntil(write);
    else await write;
  }
  return response;
}

export async function routeRequest(request, env, ctx = {}, {
  relay = relayHandle,
  jpl = handleJpl,
} = {}) {
  const url = new URL(request.url);

  // Cloudflare normally serves matching assets before invoking this Worker. This
  // explicit lookup preserves the same ordering in tests and for missing assets.
  if ((request.method === 'GET' || request.method === 'HEAD') && env?.ASSETS?.fetch) {
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;
    asset.body?.cancel?.().catch(() => {});
  }

  if (!isRelayPath(url.pathname)) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const cache = globalThis.caches?.default;
  if (JPL_PATHS.has(url.pathname)) {
    return jpl(request, { cache, waitUntil: ctx.waitUntil?.bind(ctx) });
  }
  return relay(request, { cache });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await routeRequest(request, env, ctx);
    } catch (error) {
      return textResponse(`Relay error: ${error?.message || 'unknown error'}`, 502, {
        'Cache-Control': 'no-store',
      });
    }
  },
};
