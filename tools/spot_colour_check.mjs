// Spot "Colour (estimate)" on the saved targets, run the way the Spot page runs it: the app's own loading
// path (prebaked answers through the relay), the season stacks Spot blinks, the dot Spot measures at the
// target's catalogue place in each blinked season, then colour.js colourEstimate (the dot's season first).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Usage: node tools/spot_colour_check.mjs [relay base, default http://127.0.0.1:8787] [preset keys...]
import { readFileSync } from 'node:fs';
import { configurePrebaked } from '../web/core/prebaked.js';
import { planImages, gridFor, loadFrame, buildStacks, seasons as groupSeasons } from '../web/app/data.js';
import { mapLimit } from '../web/core/irsa.js';
import { worldToGrid } from '../web/core/align.js';
import { propagate } from '../web/core/motion.js';
import { LOAD_SETTINGS, QUICK, fieldBand, framesForField, dotAt } from '../web/app/spot/logic.js';
import { measureColour, colourEstimate, ratioText } from '../web/app/spot/colour.js';

const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
configurePrebaked({ manifestUrl: `${BASE}/prebaked/manifest.json`, fileBase: `${BASE}/prebaked/`, origin: BASE });
const tables = JSON.parse(readFileSync(new URL('../web/core/data/spectral_wcs.json', import.meta.url), 'utf8'));
const keys = process.argv.slice(3).length ? process.argv.slice(3) : QUICK.map(f => f.key);
const f2 = (v) => (v == null ? '—' : v.toFixed(2));
for (const f of QUICK.filter(q => keys.includes(q.key))) {
  const plan = await planImages(f.target, LOAD_SETTINGS, { base: BASE });
  const grid = gridFor(f.target, plan.chosen, LOAD_SETTINGS.fov);
  const got = await mapLimit(plan.chosen, 6, im => loadFrame(im, f.target, grid, LOAD_SETTINGS, { base: BASE, tables }));
  const frames = got.filter(r => r.ok).map(r => r.value).sort((a, b) => a.mjd - b.mjd);
  const all = groupSeasons(frames);
  const use = framesForField(frames, fieldBand(f), groupSeasons);
  const st = buildStacks(use.frames), seasonFrames = groupSeasons(use.frames);
  const blink = [0, st.length - 1].map((i, k) => {
    const stack = st[i], p = propagate(f.target, stack.mjd), [gx, gy] = worldToGrid(grid, p.ra, p.dec);
    const d = dotAt(stack, gx, gy) || { x: gx, y: gy };
    const own = all.find(g => g.frames.includes(seasonFrames[i].frames[0]));
    return { label: k ? 'latest season' : 'first season', rows: measureColour(own.frames, d.x, d.y).rows };
  });
  for (const k of [0, 1]) {
    const c = colourEstimate(k ? [blink[1], blink[0]] : blink);
    const g = (G) => `${G.id} ${G.used}/${G.n}${G.mean != null ? ` ${G.mean.toFixed(3)}±${G.err.toFixed(3)} mJy` : ''}`;
    console.log(JSON.stringify({ target: f.key, dotSeason: blink[k].label, used: c.seasons.join(' + '), cls: c.cls, text: c.text, ratio: ratioText(c),
      x: c.x != null ? `${f2(c.x)} ± ${f2(c.xErr)}` : null, t: c.t != null ? f2(c.t) : null, lines: { rStar: f2(c.b.rStar), xStar: f2(c.b.xStar), tWarm: f2(c.b.tWarm) },
      groups: ['S', 'M', 'L'].map(id => g(c.groups[id])).join(' | '), why: c.why }));
  }
}
