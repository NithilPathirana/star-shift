// Pre-bake NASA's five test targets: run the app's own data pipeline through the local
// server so every request (image list + cutouts) lands in its disk cache. After this,
// the five targets load instantly in the browser, even offline or when IRSA is down.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Usage: (server running) node tools/prebake.mjs [fov=10] [max=120] [band=all] [keys...]
import { readFileSync } from 'node:fs';
import { run } from '../web/app/data.js';
import { PRESETS } from '../web/app/presets.js';
import { DEFAULT_SETTINGS } from '../web/app/query.js';

const [fov = '10', max = '120', band = 'all', ...keys] = process.argv.slice(2);
const base = process.env.BASE || 'http://127.0.0.1:8787';
const settings = { ...DEFAULT_SETTINGS, fov: Number(fov), max: Number(max), band };
const tables = JSON.parse(readFileSync(new URL('../web/core/data/spectral_wcs.json', import.meta.url), 'utf8'));
const targets = keys.length ? PRESETS.filter(p => keys.includes(p.key)) : PRESETS;

for (let pass = 1; pass <= 3; pass++) {
  let missing = 0;
  for (const p of targets) {
    const t0 = Date.now();
    let planned = 0, ok = 0, failed = 0;
    await run({ type: 'name', name: p.label }, settings, {
      base, tables, concurrency: 6,
      emit: (e) => {
        if (e.type === 'PLANNED') planned = e.plan.planned;
        if (e.type === 'FRAME') ok++;
        if (e.type === 'FRAME_FAILED') failed++;
        if (e.type === 'ERROR') console.log(`  ${p.label}: ${e.message}`);
      },
    });
    missing += failed;
    console.log(`pass ${pass} | ${p.label}: ${ok}/${planned} frames cached, ${failed} failed, ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  if (!missing) break;
}
