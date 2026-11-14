// Data for the display-options comparison sheets (evidence only, not the website).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// For one target: take the first observing season, fetch up to N frames per detector as
// 30' cutouts, mask bad pixels, put them on one north-up 30' grid, and save single frames
// and per-detector median stacks to evidence/display_<key>.json.
// Usage: node tools/display_data.mjs "<SIMBAD name>" <key> [perDetector=4]
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolveName } from '../web/core/resolve.js';
import { listImages, fetchCutout, decodeCutout, mapLimit, cutoutUrl, maskBadPixels } from '../web/core/irsa.js';
import { readHDUsFromStream } from '../web/core/fits.js';
import { propagate, epochYearToMjd, mjdToDate } from '../web/core/motion.js';
import { makeGrid, reproject, stackFrames } from '../web/core/align.js';

const [name, key, perDetArg] = process.argv.slice(2);
const PER_DET = Number(perDetArg) || 4;
const SIZE = 0.5; // degrees (30')
const CACHE = new URL('../evidence/cache/', import.meta.url);
mkdirSync(CACHE, { recursive: true });

async function cached(uri, ra, dec) {
  const f = new URL(createHash('sha1').update(cutoutUrl(uri, ra, dec, SIZE)).digest('hex') + '.fits', CACHE);
  if (existsSync(f)) return decodeCutout(new Uint8Array(readFileSync(f)));
  let raw;
  const c = await fetchCutout(uri, ra, dec, SIZE, {
    fetchFn: async (u, o) => {
      const res = await fetch(u, o);
      if (!res.ok) return res;
      raw = await readHDUsFromStream(res.body, 3, 32 * 1024 * 1024);
      return new Response(raw);
    },
  });
  writeFileSync(f, raw);
  return c;
}

const star = await resolveName(name);
const mid = propagate(star, epochYearToMjd(2026));
const all = await listImages(mid.ra, mid.dec);
// first season = images within 45 days of the first one
const season = all.filter(im => im.mjdStart - all[0].mjdStart < 45);
const chosen = [];
for (let d = 1; d <= 6; d++) {
  const ds = season.filter(im => im.detector === d);
  for (let k = 0; k < Math.min(PER_DET, ds.length); k++) chosen.push(ds[Math.round((k * (ds.length - 1)) / Math.max(1, Math.min(PER_DET, ds.length) - 1))]);
}
const tMid = season.reduce((a, im) => a + im.mjdStart, 0) / season.length;
const pos = propagate(star, tMid);
const grid = makeGrid(pos.ra, pos.dec, 1800); // 30' at 6.15"/px
let done = 0;
const res = await mapLimit(chosen, 6, async (im) => {
  const c = maskBadPixels(await cached(im.uri, pos.ra, pos.dec));
  return { det: c.detector, date: c.date, frame: reproject(c, grid) };
}, () => { if (++done % 4 === 0) console.log(`  ${done}/${chosen.length}`); });
const ok = res.filter(r => r.ok).map(r => r.value);
console.log(`${name}: season ${mjdToDate(season[0].mjdStart).toISOString().slice(0, 10)} (${season.length} images), fetched ${ok.length}/${chosen.length}`);
const toArr = (d) => Array.from(d, v => (Number.isFinite(v) ? +v.toPrecision(5) : null));
const stacks = {};
for (let d = 1; d <= 6; d++) {
  const fr = ok.filter(o => o.det === d);
  if (fr.length) stacks[d] = { n: fr.length, data: toArr(stackFrames(fr.map(o => o.frame)).data) };
}
const singles = ok.map(o => ({ det: o.det, date: o.date, data: toArr(o.frame.data) }));
writeFileSync(new URL(`../evidence/display_${key}.json`, import.meta.url), JSON.stringify({
  name: star.name, ra: pos.ra, dec: pos.dec, grid, seasonStart: mjdToDate(season[0].mjdStart).toISOString().slice(0, 10),
  seasonEnd: mjdToDate(season[season.length - 1].mjdStart).toISOString().slice(0, 10), stacks, singles,
}));
console.log('wrote evidence/display_' + key + '.json');
