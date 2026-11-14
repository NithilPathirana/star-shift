// Local server: serves the website from web/ and the IRSA/Gaia relay on the same port.
// Uses exactly the same relay code as proxy/worker.js, so the project can later move to
// any host (Cloudflare Worker, etc.) without changes. No secrets, read-only, localhost only.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Usage: node server/server.mjs [port]   (default 8787, binds 127.0.0.1)

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../proxy/worker.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = join(ROOT, 'web');
const LOADER = join(ROOT, 'design', 'loader'); // Design Studio's rocket loader renders (updated in place)
const CACHE_DIR = join(ROOT, '.cache', 'relay');
const PORT = Number(process.argv[2] || process.env.PORT) || 8787;
const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.fits': 'application/fits', '.txt': 'text/plain; charset=utf-8', '.webm': 'video/webm', '.mp4': 'video/mp4',
};

// Disk cache with the Cache API shape the relay expects (match/put). SPHEREx cutouts never
// change once released, so repeat views (and the demo) load instantly and offline.
export function diskCache(dir = CACHE_DIR) {
  const file = (req) => join(dir, createHash('sha1').update(req.url).digest('hex'));
  return {
    async match(req, { ignoreExpiry = false } = {}) {
      try {
        const [body, meta] = await Promise.all([readFile(file(req)), readFile(file(req) + '.json', 'utf8')]);
        const m = JSON.parse(meta);
        if (!ignoreExpiry && Date.now() > m.expires) return undefined;
        return new Response(body, { status: 200, headers: m.headers });
      } catch { return undefined; }
    },
    async put(req, res) {
      const maxAge = /max-age=(\d+)/.exec(res.headers.get('Cache-Control') || '');
      if (!maxAge || res.status !== 200) return;
      await mkdir(dir, { recursive: true });
      const body = Buffer.from(await res.arrayBuffer());
      const headers = Object.fromEntries(res.headers);
      await writeFile(file(req), body);
      await writeFile(file(req) + '.json', JSON.stringify({ url: req.url, headers, expires: Date.now() + Number(maxAge[1]) * 1000 }));
    },
  };
}

const RELAY = /^\/(TAP\/sync|SIA$|gaia\/tap\/sync|ibe\/data\/spherex\/|hips\/spherex\/)/;

async function serveStatic(path, res) {
  let rel = decodeURIComponent(path);
  let base = WEB;
  if (rel.startsWith('/loader/')) { // only the loader media, nothing else from design/
    if (!/^\/loader\/(v1\.1\/)?[\w.-]+\.(webm|mp4|webp|png)$/.test(rel)) { res.writeHead(404).end('Not found'); return; }
    base = LOADER; rel = rel.slice('/loader'.length);
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const full = normalize(join(base, rel));
  if (!full.startsWith(base + sep) && full !== base) { res.writeHead(403).end('Forbidden'); return; }
  try {
    const st = await stat(full);
    if (st.isDirectory()) { res.writeHead(301, { Location: path + '/' }).end(); return; }
    const body = await readFile(full);
    res.writeHead(200, { 'Content-Type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

export function createApp({ cache = diskCache(), fetchFn = fetch } = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    try {
      if (url.pathname === '/health' || RELAY.test(url.pathname)) {
        const r = await handle(new Request(url, { method: req.method }), { cache, fetchFn, tapTtl: 7 * 86400, staleIfError: true });
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      await serveStatic(url.pathname, res);
    } catch (e) {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Server error: ' + (e && e.message));
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  createApp().listen(PORT, HOST, () => console.log(`Serving web/ and relay at http://${HOST}:${PORT}/`));
}
