// Export everything the five NASA demo targets need on first load into web/prebaked/, so they load
// instantly on any Cloudflare data centre (or offline) without asking IRSA, SIMBAD, Gaia or JPL.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// It runs the app's own loading code in Node (web/app/data.js run(), skymap.js simbadCone,
// spot/checks.js runStarCheck + runAsteroidCheck, neo/sb-ident.js) with a recording fetch that
// answers through the relay code itself (proxy/worker.js handle() with the local server's disk
// cache, .cache/relay, and the server's own options), and saves each answer byte for byte.
// web/core/prebaked.js then answers EXACTLY those requests from the files; nothing else.
//
// What is captured, per preset (the viewer's defaults: 2.5′ field, 120 images, all bands):
//  - map: the pin's coverage image list (SIA at the pin's "now" position) and its 3′ SIMBAD cone;
//  - viewer: the SIA and TAP image lists (merged into the complete list, judging panel a4b) and the trimmed 3-HDU cutouts the app fetches,
//    plus the "Other source" SIMBAD cone (brightest other source in the first-season stack);
//    the Ghost and Motion panel use the built-in preset values, so they need no Gaia call;
//  - Spot a mover: the same image list and cutouts, and the field-level lookups the page starts
//    when a field loads (Gaia + SIMBAD around the patch centre, JPL sb_ident for the whole patch
//    in each blinked season), so any click in the patch is answered from these files;
//  - Spectrum page (spectral.html): the same image list and its 0.03° cutouts (16 per detector, the default);
//  - Asteroid page (neo.html): its default field and dates (6 sb_ident requests).
// The `hdus=5` cutouts (VARIANCE/ZODI) are fetched only when a user opens those layers: not saved.
// JPL is asked politely: the relay's cached copy (any age) first; only if there is none, one live
// request per URL (100 s budget). What JPL did not answer is listed in the manifest.
//
// Usage: node tools/export_prebaked.mjs            (writes web/prebaked/, replacing it)
//        BASE=http://127.0.0.1:8787 is only the key prefix; the server need not be running.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../proxy/worker.js';
import { diskCache } from '../server/server.mjs';
import { run, buildStacks, seasons } from '../web/app/data.js';
import { PRESETS } from '../web/app/presets.js';
import { DEFAULT_SETTINGS } from '../web/app/query.js';
import { listImages, decodeCutout, setCompleteMode, fetchCutout } from '../web/core/irsa.js';
import { pickImages, CUTOUT_DEG } from '../web/app/spectral/logic.js';
import { simbadCone } from '../web/app/skymap.js';
import { fetchFieldStars, fetchFieldAsteroids } from '../web/app/spot/checks.js';
import { LOAD_SETTINGS, fieldCentre } from '../web/app/spot/logic.js';
import { buildSbIdentParams, DEFAULT_DATES } from '../web/app/neo/sb-ident.js';
import { propagate } from '../web/core/motion.js';
import { gridToWorld, worldToGrid } from '../web/core/align.js';
import { prebakedKey } from '../web/core/prebaked.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'web', 'prebaked');
const CACHE_DIR = join(ROOT, '.cache', 'relay');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const SETTINGS = { ...DEFAULT_SETTINGS, fov: 2.5, max: 120, band: 'all' }; // ui.js SETTINGS
const TABLES = JSON.parse(readFileSync(join(ROOT, 'web', 'core', 'data', 'spectral_wcs.json'), 'utf8'));
// { presetKey: [request URL, ...] } seen in a real browser load (performance entries) but not made by
// the replay below, e.g. the viewer's "other source" SIMBAD cone when the page's stack differs a little.
const EXTRA = (() => { try { const j = JSON.parse(readFileSync(join(ROOT, 'tools', 'prebake_extra.json'), 'utf8')); delete j.about; return j; } catch { return {}; } })();
const IRSA_MS = 120000, JPL_MS = 100000, SIMBAD_MS = 20000;
const SPECTRUM_PER_DETECTOR = 16; // spectral.html #perDet default
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const mib = (b) => +(b / 1048576).toFixed(2);

// Values that live in browser-only modules (ui.js, neo/spotter.js), read from their source so a change there is followed.
const uiSrc = readFileSync(join(ROOT, 'web', 'app', 'ui.js'), 'utf8');
const spotterSrc = readFileSync(join(ROOT, 'web', 'app', 'neo', 'spotter.js'), 'utf8');
const grab = (src, re, what) => { const m = re.exec(src); if (!m) throw new Error(`Could not read ${what}`); return Number(m[1]); };
const NOW_MJD = grab(uiSrc, /const NOW_MJD = (\d+(?:\.\d+)?)/, 'NOW_MJD from ui.js');
const NEO_VIEW = {
  ra: grab(spotterSrc, /finiteParam\('ra', ([\d.]+)/, 'the Asteroid page default RA'),
  dec: grab(spotterSrc, /finiteParam\('dec', (-?[\d.]+)/, 'the Asteroid page default Dec'),
  fov: grab(spotterSrc, /finiteParam\('fov', ([\d.]+)/, 'the Asteroid page default field'),
};
if (SETTINGS.fov !== LOAD_SETTINGS.fov || SETTINGS.max !== LOAD_SETTINGS.max || SETTINGS.band !== LOAD_SETTINGS.band) {
  console.log('Note: Spot a mover uses different load settings from the viewer; its cutouts are captured separately.');
}

/* ------------------------------------------------------------------ recording fetch through the relay code */
const disk = diskCache(CACHE_DIR);
const captures = new Map(); // key -> { bytes, kind, owner, fetched }

function kindOf(key) {
  if (key.startsWith('/SIA?')) return { kind: 'sia', ext: '.xml' };
  if (key.startsWith('/TAP/sync?')) return { kind: 'tap', ext: '.csv' };
  if (key.startsWith('/ibe/data/spherex/')) return { kind: 'cutout', ext: '.fits' };
  if (key.startsWith('/gaia/tap/sync?')) return { kind: 'gaia', ext: '.csv' };
  if (key.startsWith('/jpl/sb_ident?')) return { kind: 'jpl-sb_ident', ext: '.json' };
  if (/^https:\/\/simbad\./.test(key)) return { kind: 'simbad', ext: '.csv' };
  return null; // anything else is not prebaked
}

const both = (a, b) => (a && b ? AbortSignal.any([a, b]) : a || b);

// One request through proxy/worker.js handle() with the local server's disk cache and options.
// JPL: cached copy of any age first, then at most one live request.
async function relay(url, init) {
  let fetchedAt = null;
  const cache = {
    async match(req, opts) {
      const hit = await disk.match(req, opts);
      if (hit) { try { fetchedAt = (await stat(join(CACHE_DIR, sha1(req.url)))).mtime; } catch { /* keep null */ } }
      return hit;
    },
    put: (req, res) => disk.put(req, res),
  };
  const live = (ms) => (u, o = {}) => { fetchedAt = null; return fetch(u, { ...o, signal: both(init?.signal, AbortSignal.timeout(ms)) }); };
  const req = new Request(url);
  if (new URL(url).pathname.startsWith('/jpl/')) {
    const cached = await handle(req, { cache, fetchFn: async () => { throw new Error('cache only'); }, staleIfError: true });
    if (cached.ok) return { res: cached, fetched: fetchedAt, source: 'relay cache' };
    const res = await handle(req, { cache, fetchFn: live(JPL_MS), staleIfError: true });
    return { res, fetched: fetchedAt || new Date(), source: res.ok ? 'JPL (live)' : 'no answer' };
  }
  const res = await handle(req, { cache, fetchFn: live(IRSA_MS), tapTtl: 7 * 86400, staleIfError: true });
  return { res, fetched: fetchedAt || new Date(), source: fetchedAt ? 'relay cache' : 'live' };
}

const jplLog = []; // every sb_ident request: { owner, key, ok, status, source }

function recorder(owner) {
  return async (input, init = {}) => {
    const url = String(input instanceof URL ? input.href : input?.url ?? input);
    const abs = url.startsWith('/') ? BASE + url : url;
    const key = prebakedKey(abs, BASE);
    const k = kindOf(key);
    let res, fetched = new Date(), source = 'live';
    try {
      if (abs.startsWith(BASE + '/')) ({ res, fetched, source } = await relay(abs, init));
      else res = await fetch(abs, { ...init, signal: both(init.signal, AbortSignal.timeout(SIMBAD_MS)) });
    } catch (e) {
      if (k?.kind === 'jpl-sb_ident') jplLog.push({ owner, key, ok: false, error: String(e.message || e) });
      throw e;
    }
    if (k?.kind === 'jpl-sb_ident') jplLog.push({ owner, key, ok: res.ok, status: res.status, source });
    if (!res.ok || !k) return res;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let good = true;
    if (k.kind === 'cutout') { try { decodeCutout(bytes, /[?&]hdus=5/.test(key) ? 5 : 3); } catch { good = false; } }
    if (k.kind === 'jpl-sb_ident') { try { good = !!JSON.parse(new TextDecoder().decode(bytes))?.signature; } catch { good = false; } }
    if (good && !captures.has(key)) captures.set(key, { bytes, ...k, owner, fetched });
    return new Response(bytes, { status: res.status, headers: res.headers });
  };
}

/* ------------------------------------------------------------------ the app's loading paths */
async function viewer(p, rec) {
  let frames = [], plan = null, failed = 0;
  for (let pass = 1; pass <= 3; pass++) {
    frames = []; failed = 0; plan = null;
    let error = null;
    await run({ type: 'name', name: p.label }, SETTINGS, { base: BASE, fetchFn: rec, tables: TABLES, concurrency: 4, emit: (e) => {
      if (e.type === 'PLANNED') plan = e.plan;
      else if (e.type === 'FRAME') frames.push(e.frame);
      else if (e.type === 'FRAME_FAILED') failed++;
      else if (e.type === 'ERROR' || e.type === 'NOT_FOUND') error = e.message;
    } });
    if (error) console.log(`  ${p.label}: ${error}`);
    if (plan && !failed) break;
    if (pass < 3) { console.log(`  ${p.label}: ${plan ? failed + ' images' : 'the image list'} failed; waiting 30 s, then asking again`); await sleep(30000); }
  }
  frames.sort((a, b) => a.mjd - b.mjd);
  return { frames, plan, failed };
}

// ui.js findOther(): brightest pixel of the first-season stack at least 5 px from the star, then SIMBAD 15″.
async function otherSource(frames, grid, rec) {
  const st = buildStacks(frames)[0];
  if (!st) return null;
  const [ex, ey] = st.expected || [grid.c, grid.c], n = grid.n;
  let best = -Infinity, bx = 0, by = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = st.data[y * n + x];
    if (!Number.isFinite(v) || Math.hypot(x - ex, y - ey) < 5) continue;
    if (v > best) { best = v; bx = x; by = y; }
  }
  const [ra, dec] = gridToWorld(grid, bx, by);
  await simbadCone(ra, dec, 15 / 3600, { limit: 5, timeoutMs: SIMBAD_MS, fetchFn: rec }).catch(e => console.log('  Other source SIMBAD: ' + e.message));
  return { px: [bx, by] }; // the page's pick can differ (its stack differs a little): tools/prebake_extra.json
}

// Spot a mover (spot/main.js fieldStars + fieldAsteroids): the field-level lookups the page starts
// as soon as a field loads, so ANY click in the five demo fields is answered from these files:
// Gaia + SIMBAD around the patch centre, and JPL sb_ident for the whole patch at the real UTC of
// each blinked season's middle image. (Matching a ring against them happens in the page.)
async function spot(p, frames, grid, rec) {
  const stacks = buildStacks(frames), groups = seasons(frames);
  if (stacks.length < 2) return { skipped: 'one season only' };
  const pick = (i) => { const fs = groups[i].frames; let b = fs[0]; for (const f of fs) if (Math.abs(f.mjd - stacks[i].mjd) < Math.abs(b.mjd - stacks[i].mjd)) b = f; return b; };
  const centre = fieldCentre(grid);
  const blink = [0, stacks.length - 1].map((i, k) => { const f = pick(i); return { label: k ? 'Latest season' : 'First season', mjd: f.mjd, utc: f.date, obsid: f.obsid }; });
  const cat = await fetchFieldStars({ centre, base: BASE, fetchFn: rec }).catch(e => ({ gaia: { ok: false, error: e.message }, simbad: { ok: false, error: e.message } }));
  // one request per season, as the page does (each season is its own lookup there)
  const jpl = [];
  for (const season of blink) jpl.push(...await fetchFieldAsteroids({ centre, seasons: [season], base: BASE, fetchFn: rec, timeoutMs: 2 * JPL_MS })
    .catch(e => [{ ...season, ok: false, error: e.message }]));
  return {
    field: { centre, note: 'field-level requests: any click in this patch is answered from these files' },
    starCheck: { gaia: cat.gaia.ok, simbad: cat.simbad.ok },
    asteroidCheck: { seasons: jpl.map(r => ({ label: r.label, utc: r.utc, ok: !!r.ok, objects: r.ok ? r.rows.length : null, observer: r.observer || null, error: r.ok ? null : (r.error || (r.status ? 'HTTP ' + r.status : 'no answer')) })) },
  };
}

// Spectrum page (spectral/main.js load + measureImage) with its defaults: the image list at the
// star's late-2025 place (archive/shell.js listPosition, the same list the viewer saves) and a
// 0.03° cutout of each picked image (16 per detector) centred on the star's place on that date.
async function spectrum(p, rec) {
  const t = p.target, moving = !!(t.pmra || t.pmdec);
  const lp = moving ? propagate(t, 61000) : t;
  const ims = await listImages(lp.ra, lp.dec, { base: BASE, fetchFn: rec });
  const picked = pickImages(ims, SPECTRUM_PER_DETECTOR);
  let ok = 0, failed = 0;
  const one = async (im) => {
    const c = moving ? propagate(t, im.mjdStart) : t; // archive/shell.js cutoutCenter
    for (let pass = 0; pass < 3; pass++) {
      try { await fetchCutout(im.uri, +c.ra.toFixed(5), +c.dec.toFixed(5), CUTOUT_DEG, { base: BASE, fetchFn: rec }); ok++; return; }
      catch (e) { if (pass < 2) await sleep(5000); }
    }
    failed++;
  };
  for (let i = 0; i < picked.length; i += 4) await Promise.all(picked.slice(i, i + 4).map(one));
  return { picked: picked.length, ok, failed };
}

// neo/spotter.js fetchIdentification() for the default view, both kinds, each default date.
async function asteroidPage(rec) {
  const out = [];
  for (const date of DEFAULT_DATES) for (const kind of ['a', 'c']) {
    const base = { ...NEO_VIEW, date, kind };
    let res = await rec(`/jpl/sb_ident?${buildSbIdentParams(base)}`).catch(e => ({ ok: false, status: 0, error: e.message }));
    let observer = 'mpc-500';
    if (!res.ok) { observer = 'geocentric-state'; res = await rec(`/jpl/sb_ident?${buildSbIdentParams({ ...base, observer })}`).catch(e => ({ ok: false, status: 0, error: e.message })); }
    out.push({ date, kind, ok: !!res.ok, observer: res.ok ? observer : null, error: res.ok ? null : (res.error || 'HTTP ' + res.status) });
    await res.arrayBuffer?.().catch(() => {});
  }
  return out;
}

/* ------------------------------------------------------------------ main */
console.log(`export_prebaked: ${PRESETS.length} targets, fov ${SETTINGS.fov}′, max ${SETTINGS.max}, band ${SETTINGS.band}; relay code + disk cache ${CACHE_DIR}`);
const summary = {};
for (const p of PRESETS) {
  const t0 = Date.now();
  const rec = recorder(p.key);
  const pin = propagate(p.target, NOW_MJD); // ui.js TARGETS: the pin sits at the star's "now" place
  // The map pin's coverage line: the quick SIA list only (its TAP list is not saved, so the page uses SIA too).
  setCompleteMode('never');
  await listImages(pin.ra, pin.dec, { base: BASE, fetchFn: rec }).catch(e => console.log(`  ${p.label} map coverage: ${e.message}`));
  setCompleteMode('always'); // the viewer and Spot lists: SIA + TAP, saved, so the page uses the complete list (a4b)
  await simbadCone(pin.ra, pin.dec, 3 / 60, { limit: 400, timeoutMs: SIMBAD_MS, fetchFn: rec }).catch(e => console.log(`  ${p.label} map SIMBAD: ${e.message}`));
  const { frames, plan, failed } = await viewer(p, rec);
  if (!plan || !frames.length) { console.log(`  ${p.label}: no images; nothing prebaked for the viewer`); summary[p.key] = { label: p.label, frames: 0, planned: plan?.planned ?? 0, failed }; continue; }
  const other = await otherSource(frames, plan.grid, rec);
  // Requests a real browser run made that the Node replay above does not predict (tools/prebake_extra.json).
  for (const url of EXTRA[p.key] || []) await rec(url).then(r => r.arrayBuffer?.()).catch(e => console.log(`  ${p.label} extra request: ${e.message}`));
  const sp = await spot(p, frames, plan.grid, rec);
  const spec = await spectrum(p, rec).catch(e => ({ error: e.message }));
  summary[p.key] = { label: p.label, planned: plan.planned, frames: frames.length, failed, otherSourcePx: other?.px ?? null, spot: sp, spectrum: spec };
  console.log(`${p.label}: ${frames.length}/${plan.planned} images, ${failed} failed; Spot JPL ${sp.asteroidCheck ? sp.asteroidCheck.seasons.map(s => s.ok ? 'ok' : 'missing').join('/') : sp.skipped}; Spectrum ${spec.error || `${spec.ok}/${spec.picked} cutouts`}; ${Math.round((Date.now() - t0) / 1000)} s`);
}
const neo = await asteroidPage(recorder('neo'));
console.log(`Asteroid page (${NEO_VIEW.ra}, ${NEO_VIEW.dec}, ${NEO_VIEW.fov}°): ${neo.filter(r => r.ok).length}/${neo.length} JPL answers`);

/* ------------------------------------------------------------------ write web/prebaked/ */
// A JPL answer saved by an earlier export is kept when JPL did not answer this time (same request,
// same prediction; JPL often stops answering at night).
let carried = 0;
try {
  const old = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
  for (const [key, e] of Object.entries(old.entries || {})) {
    if (e.kind !== 'jpl-sb_ident' || captures.has(key)) continue;
    const owner = e.file.split('/')[0];
    captures.set(key, { bytes: readFileSync(join(OUT, e.file)), kind: e.kind, ext: '.json', owner, fetched: new Date(e.fetched) });
    for (const r of jplLog) if (r.key === key) r.ok = true, r.source = 'earlier export';
    carried++;
  }
} catch { /* first export */ }
if (carried) console.log(`Kept ${carried} JPL answers from the earlier export (JPL did not answer them now).`);
await rm(OUT, { recursive: true, force: true });
const entries = {}, per = {};
for (const [key, c] of [...captures].sort((a, b) => a[0].localeCompare(b[0]))) {
  const file = `${c.owner}/${sha1(key).slice(0, 16)}${c.ext}`;
  await mkdir(dirname(join(OUT, file)), { recursive: true });
  await writeFile(join(OUT, file), c.bytes);
  entries[key] = { file, size: c.bytes.length, fetched: (c.fetched || new Date()).toISOString(), kind: c.kind };
  const s = per[c.owner] ||= { files: 0, bytes: 0, kinds: {} };
  s.files++; s.bytes += c.bytes.length; s.kinds[c.kind] = (s.kinds[c.kind] || 0) + 1;
}
const jplMissing = jplLog.filter(r => !r.ok).map(({ owner, key, status, error }) => ({ owner, key, status: status ?? null, error: error ?? null }));
const manifest = {
  about: 'Star Shift prebaked answers for the five NASA demo targets (tools/export_prebaked.mjs; read by web/core/prebaked.js). Keys are request paths as the app builds them, relative to the page origin (the relay); SIMBAD keys are full URLs. Exact matches only; anything else goes live.',
  generated: new Date().toISOString(),
  settings: { fov: SETTINGS.fov, max: SETTINGS.max, band: SETTINGS.band, mapNowMjd: NOW_MJD },
  targets: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { ...v, files: per[k]?.files ?? 0, mib: mib(per[k]?.bytes ?? 0), kinds: per[k]?.kinds ?? {} }])),
  asteroidPage: { view: NEO_VIEW, dates: DEFAULT_DATES, results: neo, files: per.neo?.files ?? 0 },
  jpl: { asked: jplLog.length, answered: jplLog.filter(r => r.ok).length, notAnswered: jplMissing, note: jplMissing.length ? 'Requests JPL did not answer go live on the page (the Spot verdict never waits for JPL).' : 'All JPL requests answered.' },
  totals: { files: Object.keys(entries).length + 1, mib: mib(Object.values(entries).reduce((a, e) => a + e.size, 0)) },
  entries,
};
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log('\nPer owner (files, MiB):');
for (const [k, s] of Object.entries(per)) console.log(`  ${k.padEnd(11)} ${String(s.files).padStart(4)} files  ${mib(s.bytes).toFixed(2).padStart(6)} MiB  ${JSON.stringify(s.kinds)}`);
console.log(`Total: ${manifest.totals.files} files (with manifest), ${manifest.totals.mib} MiB; JPL ${manifest.jpl.answered}/${manifest.jpl.asked} answered.`);
