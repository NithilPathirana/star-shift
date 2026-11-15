// One season source (judging panel round 4, item 1): the viewer's chip, "Season k of N", timeline labels,
// stacks and brightness-chart axis all use seasons.js, and for R Draconis they agree with the Proof page.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seasonBounds, seasonAt, groupInto, seasonMonths, splitSeasons } from '../web/app/seasons.js';
import { seasons, buildStacks, planImages } from '../web/app/data.js';
import { seasonsOf } from '../web/app/archive/logic.js';
import { seasonIndex, lightcurve } from '../web/app/lightcurve/logic.js';
import { configurePrebaked } from '../web/core/prebaked.js';
import { findPreset } from '../web/app/presets.js';

const ORIGIN = 'https://star-shift.example';
const proof = JSON.parse(readFileSync(new URL('../web/data/proof.json', import.meta.url), 'utf8'));
const day = (m) => new Date((m - 40587) * 864e5).toISOString().slice(0, 10);

// The 120 images the viewer plans for R Draconis, from the saved copy (web/prebaked), as in the app.
async function plannedMjds(key) {
  const fetchImpl = async (url) => {
    const u = String(url).replace(ORIGIN + '/prebaked/', '');
    return new Response(readFileSync(new URL('../web/prebaked/' + u, import.meta.url)));
  };
  configurePrebaked({ manifestUrl: ORIGIN + '/prebaked/manifest.json', fileBase: ORIGIN + '/prebaked/', origin: ORIGIN, fetchImpl });
  try {
    const p = findPreset(key);
    const plan = await planImages(p.target, { fov: 2.5, max: 120, band: 'all' }, { base: ORIGIN });
    return plan.chosen.map(im => ({ mjd: im.mjdStart, detector: im.detector }));
  } finally { configurePrebaked(null); }
}

test('R Draconis: the viewer\'s seasons are the Proof page\'s (dates and counts)', async () => {
  const ims = await plannedMjds('r-dra');
  const B = seasonBounds(ims.map(i => i.mjd));
  const P = proof.targets.find(t => t.key === 'r-dra').images.seasons;
  assert.equal(B.length, P.length);
  assert.deepEqual(B.map(s => ({ from: day(s.startMjd), to: day(s.endMjd), n: s.n })), P);
  // the held band (3.8–5.0 µm): its stacks sit in those same seasons, and no stack spans two of them
  const held = ims.filter(i => [5, 6].includes(i.detector));
  for (const g of groupInto(held, B)) {
    assert.ok(g.frames.every(f => seasonAt(f.mjd, B) === g.k));
    assert.ok(g.frames[0].mjd >= B[g.k].startMjd && g.frames[g.frames.length - 1].mjd <= B[g.k].endMjd);
  }
  // the chip's last stack, the "Season k of N" label and the chart axis name the same season and months
  const last = groupInto(held, B).at(-1), lbl = `Season ${last.k + 1} of ${B.length} · ${seasonMonths(B[last.k])}`;
  assert.equal(seasonAt(last.frames[0].mjd, B), last.k);
  assert.match(lbl, /^Season \d of 4 · [A-Z][a-z]{2}/);
  // the brightness chart's seasons (lightcurve/logic.js) are the same seasons
  assert.deepEqual(seasonIndex(ims.map(i => i.mjd), B), ims.map(i => seasonAt(i.mjd, B)));
  assert.deepEqual(seasonIndex(ims.map(i => i.mjd)), ims.map(i => seasonAt(i.mjd, B)));
});

test('one splitter: data.js seasons(), the Archive and the chart split the same way', () => {
  // an all-year run (no 60-day gap, 16 months) is split; a normal 6-month cadence is not
  const mjds = []; for (let m = 60790; m <= 61310; m += 9 + (m % 5)) mjds.push(m);
  const a = splitSeasons(mjds), b = seasons(mjds.map(m => ({ mjd: m }))), c = seasonsOf(mjds);
  assert.ok(a.length >= 3);
  assert.deepEqual(b.map(s => [s.startMjd, s.endMjd]), a.map(r => [r[0], r.at(-1)]));
  assert.deepEqual(c.map(s => [s.startMjd, s.endMjd, s.n]), a.map(r => [r[0], r.at(-1), r.length]));
  assert.ok(a.every(r => r.at(-1) - r[0] <= 183));
  assert.deepEqual(splitSeasons([0, 10, 200, 210, 400]), [[0, 10], [200, 210], [400]]);
});

test('stacks built on given seasons keep the season number and their own dates', () => {
  const B = seasonBounds([100, 110, 300, 310, 500, 510]);
  const fr = [300, 310, 500].map(m => ({ mjd: m, n: 1, data: new Float32Array([1]), detector: 5 }));
  const st = buildStacks(fr, B);
  assert.deepEqual(st.map(s => s.season), [1, 2]);
  assert.equal(st[1].count, 1);
  assert.equal(seasonMonths({ startMjd: 61079, endMjd: 61183 }), 'Feb–May 2026');
  assert.equal(seasonMonths({ startMjd: 61000, endMjd: 61060 }), 'Nov 2025–Jan 2026');
  assert.equal(lightcurve([], B).nSeasons, 0);
});
