// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Spot's 5th check, "Colour (estimate)" (web/app/spot/colour.js): synthetic spectra through the real
// photometry, and the rule that it never changes a verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../web/app/spot/colour.js';
import * as L from '../web/app/spot/logic.js';
import { DETECTORS } from '../web/app/bands.js';
import { pixelSr } from '../web/app/lightcurve/logic.js';

// A seeded random number generator and Gaussian noise (repeatable).
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function gauss(r) { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }

// One season of images: `per` images in each of the six detectors at spread wavelengths, a point source of
// flux spec(λ) mJy at the grid centre (Gaussian PSF, σ 0.6 px), sky noise `noise` MJy/sr per pixel.
const N = 25, PSF = 0.6;
function season(spec, { per = 6, noise = 0.02, seed = 1, saturate = [] } = {}) {
  const r = rng(seed), frames = [], c = (N - 1) / 2, toSurf = 1 / (pixelSr(6.15) * 1e9);
  for (const D of DETECTORS) for (let k = 0; k < per; k++) {
    const wl = D.min + (D.max - D.min) * (k + 0.5) / per, F = spec(wl), data = new Float64Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const g = Math.exp(-((i - c) ** 2 + (j - c) ** 2) / (2 * PSF * PSF)) / (2 * Math.PI * PSF * PSF);
      data[j * N + i] = 1.0 + F * g * toSurf + noise * gauss(r);
    }
    if (saturate.includes(D.d)) data[c * N + c] = NaN;
    frames.push({ n: N, data, detector: D.d, wavelengthUm: wl, mjd: 61000 + k });
  }
  return frames;
}
const classOf = (frames) => C.classifyColour(C.measureColour(frames, (N - 1) / 2, (N - 1) / 2).groups);
const bb = (T, scale) => (um) => scale * C.planckNu(um, T) / C.planckNu(1.6, T);

test('photometry: a known flux comes back (sky ring removed, no masked pixel)', () => {
  const fr = season(() => 5, { noise: 0.005 });
  const m = C.measureColour(fr, 12, 12);
  for (const g of ['S', 'M', 'L']) assert.ok(Math.abs(m.groups[g].mean - 5) / 5 < 0.03, `${g}: ${m.groups[g].mean}`);
  assert.ok(m.groups.S.snr > 50);
  const one = C.apPhot({ ...fr[0], data: fr[0].data.map((v, i) => (i === 12 * N + 12 ? NaN : v)) }, 12, 12);
  assert.equal(one.mJy, null, 'a masked pixel in the circle gives no number, never a wrong one');
  assert.equal(C.apPhot(fr[0], 1, 1), null, 'circle off the image: no measurement');
});

test('boundaries come from physics: Rayleigh-Jeans < sunlight < coolest star; the hottest asteroid surface still rises at 4–5 µm', () => {
  const b = C.boundaries(C.NOMINAL_WL);
  assert.ok(b.rHot < b.rSun && b.rSun < b.rStar, JSON.stringify(b));
  assert.ok(b.rHot > 0.08 && b.rHot < 0.12, 'Fν ∝ λ⁻² from ~1.4 to ~4.4 µm is about 0.1');
  assert.ok(b.rStar > 0.8 && b.rStar < 1, '2300 K blackbody');
  assert.ok(b.xSun < b.xStar, "sunlight keeps x below the coolest star");
  assert.ok(b.tWarm > 1.2, "a 600 K surface still rises steeply from 4.1 to 4.7 µm");
});

test('a blackbody star (4000 K) reads "colour looks like a star", with its ratio and error', () => {
  const c = classOf(season(bb(4000, 20)));
  assert.equal(c.cls, 'star', c.why);
  assert.equal(c.text, 'colour looks like a star');
  assert.match(C.ratioText(c), /^R = 0\.\d+ ± 0\.\d+$/);
  // hot star too
  assert.equal(classOf(season(bb(15000, 20), { seed: 2 })).cls, 'star');
});

test('a cold brown dwarf (crushed 0.75–1.1 and 2.4–3.8 µm, strong 4.5 µm peak) reads as a brown dwarf', () => {
  // T-dwarf-like: J/H peak, z crushed (water/H2), methane+water dip at 2.4-3.8, a 4-5 µm window peaking near 4.5
  const tdwarf = (um) => (um < 1.1 ? 0.6 * Math.exp(-(((um - 1.05) / 0.08) ** 2))
    : um < 2.42 ? 8 * Math.exp(-(((um - 1.27) / 0.35) ** 2)) + 1
      : um < 3.82 ? 1.2 : 30 * Math.exp(-(((um - 4.5) / 0.45) ** 2)) + 2);
  const c = classOf(season(tdwarf, { seed: 3 }));
  assert.equal(c.cls, 'brown-dwarf', c.why);
  assert.equal(c.text, 'colour looks like a cold brown dwarf (very red at 4–5 µm)');
  assert.ok(c.R > c.b.rStar);
  // a Y dwarf: nothing at all below 3.8 µm, light at 4-5 µm
  const y = classOf(season((um) => (um < 3.8 ? 0 : 3 * Math.exp(-(((um - 4.5) / 0.4) ** 2))), { seed: 4 }));
  assert.equal(y.cls, 'brown-dwarf', y.why);
  assert.match(C.ratioText(y), /R > /, 'no short-band light: a lower limit');
});

test('an asteroid (reflected sunlight + 300 K thermal) reads "sunlight + warmth"', () => {
  const sun = bb(5778, 10), thermal = bb(300, 1) , k = 25 / thermal(4.7);
  const c = classOf(season((um) => sun(um) * (1 + 0.15 * (um - 1)) + k * thermal(um), { seed: 5 }));
  assert.equal(c.cls, 'asteroid', c.why);
  assert.equal(c.text, 'colour looks like an asteroid (sunlight + warmth)');
  // sunlight alone (a main-belt asteroid too cold to glow at 5 µm) looks like a star: colour can't tell
  assert.equal(classOf(season((um) => sun(um), { seed: 6 })).cls, 'star');
});

test('too faint, saturated and warm dust are said as such, never forced into a class', () => {
  assert.equal(classOf(season(bb(4000, 0.01), { seed: 7 })).cls, 'faint');
  assert.equal(classOf(season(bb(4000, 0.01), { seed: 7 })).text, 'too faint to tell');
  assert.equal(classOf(season(bb(4000, 2000), { seed: 8, saturate: [1, 2, 3] })).cls, 'saturated');
  const disc = (um) => bb(4000, 20)(um) + bb(900, 40)(um); // a star with warm dust round it
  assert.equal(classOf(season(disc, { seed: 9 })).cls, 'dust');
});

// ---------- it never decides or changes the verdict
function states() {
  const out = [], start = L.checklistStep(L.initChecklist(), { type: 'start' });
  const mover = { status: 'explained', mover: true, best: { name: "Barnard's Star", pm: 10.3, g: 8 }, word: 'star', text: 'moves' };
  const still = { status: 'explained', mover: false, best: { name: 'Gaia DR3 1', pm: 0, g: 19.2 }, word: 'star', text: 'still' };
  const seasonsOk = { status: 'clear', k: 2, N: 2, per: [], text: 'Present in 2 of 2 seasons.' };
  const seasonsNothing = { status: 'explained', k: 0, N: 2, per: [], nothing: true, text: 'No dot.' };
  const ast = { status: 'explained', hit: { name: '1354 Botha' }, text: 'JPL predicts' };
  const plans = [
    { star: mover }, { star: still, seasons: seasonsNothing }, { star: still, seasons: seasonsOk, flags: { status: 'clear', per: [] } },
    { star: { status: 'clear', text: 'none' }, asteroid: ast },
    { star: { status: 'clear', text: 'none' }, flags: { status: 'explained', per: [], text: 'flagged' }, seasons: seasonsOk },
    { star: { status: 'clear', text: 'none' }, flags: { status: 'clear', per: [] }, seasons: seasonsOk, asteroid: { status: 'clear', text: 'none' } },
    { star: { status: 'clear', text: 'none' }, flags: { status: 'clear', per: [] }, seasons: seasonsOk, asteroid: { status: 'failed', text: 'no reply' } },
    { star: { status: 'clear', text: 'none' }, flags: { status: 'clear', per: [] }, seasons: seasonsNothing },
  ];
  for (const p of plans) {
    let s = start;
    for (const [id, res] of Object.entries(p)) s = L.checklistStep(s, { type: 'done', id, status: res.status, text: res.text, data: res });
    out.push(s);
  }
  return out;
}
test('Colour never changes the verdict: same kind, title, wording and deciding check for every colour class', () => {
  const colours = Object.keys(C.COLOUR_TEXT).map(cls => ({ cls, text: C.COLOUR_TEXT[cls], R: 3, rErr: 0.5, b: C.boundaries(C.NOMINAL_WL) }));
  let compared = 0;
  for (const st of states()) {
    const v = L.decideVerdict(st);
    for (const col of colours) {
      const w = C.withColour(v, col);
      for (const k of ['kind', 'title', 'sub', 'body', 'decidedBy', 'notRun', 'running', 'retry', 'still', 'part']) assert.deepEqual(w[k], v[k], `${v.kind}/${col.cls}: ${k}`);
      if (v.kind === 'pending') assert.equal(w, v, 'a pending verdict is untouched');
      else { assert.deepEqual(w.evidence.slice(0, -1), v.evidence); assert.match(w.evidence.at(-1), /^Colour \(estimate\): /); compared++; }
    }
  }
  assert.ok(compared >= 30, `compared ${compared}`);
  // and decideVerdict cannot even see it: logic.js does not import the colour module
  assert.doesNotMatch(readFileSync(new URL('../web/app/spot/logic.js', import.meta.url), 'utf8'), /^import[^;]*colour/m);
});

test('wording: always "estimate", never "detected/found/discovered" or "new planet"', () => {
  for (const cls of Object.keys(C.COLOUR_TEXT)) {
    const c = { cls, text: C.COLOUR_TEXT[cls], R: 2, rErr: 0.3, x: 0.5, xErr: 0.1, why: 'test', b: C.boundaries(C.NOMINAL_WL) };
    const { simple, expert } = C.colourLines(c, 'latest season');
    for (const t of [simple, expert]) { assert.match(t, /Estimate: /); assert.doesNotMatch(t, /detected|found|discover|new planet/i); }
  }
});

// ---------- the "Known asteroid" example (one night of Botha images, web/data/spot-botha.json)
test('Botha example: offline file with sources, JPL predicted places, and the honest colour', async () => {
  const B = await import('../web/app/spot/botha.js');
  const j = JSON.parse(readFileSync(new URL('../web/data/spot-botha.json', import.meta.url), 'utf8'));
  assert.equal(j.frames.length, 8);
  assert.deepEqual([...new Set(j.frames.map(f => f.detector))].sort(), [3, 6]);
  for (const k of ['images', 'predicted', 'seenCheck', 'mask']) assert.ok(j.sources[k], `source ${k} recorded`);
  const frames = B.bothaFrames(j);
  for (const f of frames) assert.ok(Math.hypot(f.predicted.x - 12, f.predicted.y - 12) < 1, 'the predicted place is near the grid centre');
  const c = B.bothaColour(frames);
  // measured, not forced: detectors 3 and 6 only, no 2.4-3.8 µm image, so colour cannot split brown dwarf from asteroid
  assert.equal(c.cls, 'no-split', c.why);
  assert.ok(c.R > 2 && c.R < 2.7 && c.rErr < 0.3, `R = ${c.R} ± ${c.rErr}`);
  assert.ok(c.R - 2 * c.rErr > c.b.rStar, 'redder than any star at these wavelengths');
  const card = B.bothaCard(j), all = [card.title, card.sub, ...card.body, ...card.evidence].join(' ');
  assert.equal(card.title, 'Known asteroid');
  assert.match(all, /predicts/);
  assert.doesNotMatch(all, /detected|found|discover|caught|new planet/i);
  assert.match(all, /8 of 8 images/);
});
