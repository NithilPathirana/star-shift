// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026.
// Post-deploy checks for pages, relay data, CORS, targets, and private render paths.

import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PRESETS } from '../web/app/presets.js';
import { parseVOTable } from '../web/core/irsa.js';
import { propagate } from '../web/core/motion.js';

const rawBase = process.argv[2] || process.env.BASE_URL;
if (!rawBase) {
  console.error('Usage: node deploy/smoke-test.mjs https://star-shift.<subdomain>.workers.dev');
  process.exit(2);
}

let base;
try {
  base = new URL(rawBase);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('not HTTP');
  base.pathname = base.pathname.replace(/\/*$/, '/');
  base.search = '';
  base.hash = '';
} catch {
  console.error(`Invalid base URL: ${rawBase}`);
  process.exit(2);
}

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const EXPECTED_PAGE_NAMES = ['index', 'archive', 'spectral', 'proof', 'planetarium', 'neo', 'spot'];
const results = [];

function row(check, status, detail) {
  results.push({ Check: check, Result: status, Detail: detail });
}

async function run(check, fn) {
  try {
    const detail = await fn();
    row(check, 'PASS', detail || 'OK');
    return true;
  } catch (error) {
    row(check, 'FAIL', error.message);
    return false;
  }
}

async function request(path, { timeout = 45_000, ...options } = {}) {
  const response = await fetch(new URL(path, base), {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
    ...options,
  });
  return response;
}

function requireStatus(response, status, label) {
  if (response.status !== status) throw new Error(`${label}: HTTP ${response.status}, expected ${status}`);
}

function requireCors(response, label) {
  const cors = response.headers.get('Access-Control-Allow-Origin');
  if (cors !== '*') throw new Error(`${label}: missing Access-Control-Allow-Origin: *`);
}

async function publicPages() {
  const files = (await readdir(WEB)).filter((name) => name.endsWith('.html')).sort();
  const present = new Set(files.map((name) => name.slice(0, -5)));
  for (const name of EXPECTED_PAGE_NAMES) {
    if (!present.has(name)) row(`Page: ${name}`, 'SKIP', 'Not present in this build');
  }
  return files;
}

function currentPosition(target) {
  const mjdNow = 40_587 + Date.now() / 86_400_000;
  return propagate(target, mjdNow);
}

function fitsPath(rows) {
  for (const item of rows) {
    try {
      const url = new URL(item.access_url);
      if (url.hostname === 'irsa.ipac.caltech.edu'
        && /^\/ibe\/data\/spherex\/[\w./-]+\.fits$/.test(url.pathname)
        && !url.pathname.includes('..')) return url.pathname;
    } catch { /* Keep looking for a safe IRSA URL. */ }
  }
  return null;
}

async function loadTarget(preset) {
  const position = currentPosition(preset.target);
  const collections = ['spherex_dr1', 'spherex_qr3'];
  let lastError = 'no SPHEREx images returned';
  for (const collection of collections) {
    const params = new URLSearchParams({
      COLLECTION: collection,
      POS: `circle ${position.ra.toFixed(6)} ${position.dec.toFixed(6)} 0.0005`,
      RESPONSEFORMAT: 'VOTABLE',
    });
    try {
      const response = await request(`/SIA?${params}`);
      requireStatus(response, 200, `${preset.label} SIA`);
      requireCors(response, `${preset.label} SIA`);
      const rows = parseVOTable(await response.text());
      const path = fitsPath(rows);
      if (path) return { collection, count: rows.length, path, position };
      lastError = `${collection} returned ${rows.length} rows but no safe FITS URL`;
    } catch (error) {
      lastError = error.message;
    }
  }
  throw new Error(lastError);
}

await run('Home page', async () => {
  const response = await request('/');
  requireStatus(response, 200, 'home');
  return response.headers.get('Content-Type') || 'HTTP 200';
});

for (const file of await publicPages()) {
  await run(`Page: ${file.slice(0, -5)}`, async () => {
    const response = await request(`/${file}`);
    requireStatus(response, 200, file);
    return `/${file}`;
  });
}

await run('JPL relay + CORS', async () => {
  const response = await request('/jpl/sbdb?sstr=99942&phys-par=1');
  requireStatus(response, 200, 'JPL SBDB');
  requireCors(response, 'JPL SBDB');
  const data = await response.json();
  if (!data.object && !data.signature) throw new Error('JPL response was not recognisable JSON');
  return 'SBDB 99942';
});

const targetLoads = await Promise.all(PRESETS.map(async (preset) => {
  try {
    const data = await loadTarget(preset);
    return { preset, data };
  } catch (error) {
    return { preset, error };
  }
}));

for (const result of targetLoads) {
  if (result.error) row(`Target: ${result.preset.label}`, 'FAIL', result.error.message);
  else row(
    `Target: ${result.preset.label}`,
    'PASS',
    `${result.data.count} ${result.data.collection} image record(s); SIA CORS OK`,
  );
}

await run('SPHEREx cutout + CORS', async () => {
  const candidate = targetLoads.find((result) => result.data);
  if (!candidate) throw new Error('No target returned a safe FITS URL for the cutout check');
  const { path, position } = candidate.data;
  const params = new URLSearchParams({
    center: `${position.ra.toFixed(6)},${position.dec.toFixed(6)}d`,
    size: '0.01',
  });
  const response = await request(`${path}?${params}`, { timeout: 90_000 });
  requireStatus(response, 200, 'SPHEREx cutout');
  requireCors(response, 'SPHEREx cutout');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 2880 || bytes.length % 2880 !== 0) {
    throw new Error(`cutout was not a complete FITS block (${bytes.length} bytes)`);
  }
  return `${bytes.length} bytes from ${candidate.preset.label}`;
});

await run('Private loader _build path', async () => {
  const response = await request('/loader/v1.1/_build/');
  requireStatus(response, 404, 'private loader path');
  return 'HTTP 404';
});

console.table(results);
const failures = results.filter((item) => item.Result === 'FAIL');
const passes = results.filter((item) => item.Result === 'PASS');
const skips = results.filter((item) => item.Result === 'SKIP');
console.log(`${passes.length} passed, ${failures.length} failed, ${skips.length} skipped.`);
if (failures.length) process.exitCode = 1;

