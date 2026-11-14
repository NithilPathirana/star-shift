// Profile time-to-first-frame for one target through the local server (same pipeline as the site).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Usage: node tools/profile_load.mjs "<name or 'ra dec'>" [concurrency=6]
import { readFileSync } from 'node:fs';
import { run } from '../web/app/data.js';
import { parseQuery, DEFAULT_SETTINGS } from '../web/app/query.js';
const [text = 'Proxima Centauri', conc = '6'] = process.argv.slice(2);
const tables = JSON.parse(readFileSync(new URL('../web/core/data/spectral_wcs.json', import.meta.url), 'utf8'));
const t0 = performance.now(), ms = () => Math.round(performance.now() - t0);
const marks = {}; let frames = 0, retries = 0, failed = 0;
const origFetch = globalThis.fetch; let tapMs = null;
globalThis.fetch = async (u, o) => { const s = performance.now(); const r = await origFetch(u, o); if (String(u).includes('/TAP/sync')) tapMs = Math.round(performance.now() - s); return r; };
await run(parseQuery(text), { ...DEFAULT_SETTINGS, fov: 2.5, max: 120 }, { base: 'http://127.0.0.1:8787', tables, concurrency: Number(conc),
  emit: (e) => {
    if (e.type === 'RESOLVED') marks.resolved = ms();
    if (e.type === 'PLANNED') { marks.planned = ms(); marks.total = e.plan.total; }
    if (e.type === 'FRAME') { frames++; if (frames === 1) marks.first = ms(); if (frames === 8) marks.eighth = ms(); }
    if (e.type === 'RETRY_WAIT') retries++;
    if (e.type === 'FRAME_FAILED') failed++;
    if (e.type === 'DONE') marks.done = ms();
  } });
console.log(JSON.stringify({ text, conc: Number(conc), tapMs, ...marks, frames, retries, failed }));
