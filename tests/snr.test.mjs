// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Signal-to-noise tool (web/app/snr.js): a synthetic Gaussian star with known noise must give the
// SNR the noise model predicts (within 5%), and the five saved targets' real cutouts give sensible answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as S from '../web/app/snr.js';
import { decodeCutout } from '../web/core/irsa.js';
import { propagate } from '../web/core/motion.js';
import { PRESETS } from '../web/app/presets.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function gauss(r) { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }

const NX = 41, NY = 39, X0 = 20.3, Y0 = 19.6, PSF = 0.8, SKY = 5, SKY_SIG = 1, GAIN = 20;
const FLAGS = { 2: { name: 'OVERFLOW' }, 64: { name: 'NONFUNC' }, 1024: { name: 'HOT' }, 2097152: { name: 'SOURCE' } };
// Noise-free model (pixel values) and its per-pixel variance: sky noise + the star's own photon noise.
function model(total) {
  const m = new Float64Array(NX * NY), v = new Float64Array(NX * NY);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const s = total * Math.exp(-((i - X0) ** 2 + (j - Y0) ** 2) / (2 * PSF * PSF)) / (2 * Math.PI * PSF * PSF);
    m[j * NX + i] = SKY + s; v[j * NX + i] = SKY_SIG ** 2 + s / GAIN;
  }
  return { m, v };
}
function realise({ m, v }, r) { const d = new Float64Array(m.length); for (let k = 0; k < m.length; k++) d[k] = m[k] + Math.sqrt(v[k]) * gauss(r); return { nx: NX, ny: NY, data: d }; }
// The SNR the noise model predicts for the noise-free star (same aperture and sky ring as the tool).
function expected({ m, v }, r = 2) {
  const [a, b] = S.annulusFor(r); let F = 0, V = 0, N = 0, Nsky = 0;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const d = Math.hypot(i - X0, j - Y0);
    if (d <= r) { F += m[j * NX + i] - SKY; V += v[j * NX + i]; N++; } else if (d > a && d <= b) Nsky++;
  }
  const noise = Math.sqrt(V + N * N * (Math.PI / 2) * SKY_SIG ** 2 / Nsky);
  return { F, noise, snr: F / noise };
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };

test('synthetic Gaussian star + known noise: SNR within 5% of the prediction, and the predicted noise is the real scatter', () => {
  for (const [total, r] of [[60, 2], [200, 2], [200, 1], [200, 4]]) {
    const mod = model(total), exp = expected(mod, r), rn = rng(7 + total + r);
    const variance = { nx: NX, ny: NY, data: mod.v };
    const runs = Array.from({ length: 600 }, () => S.aperturePhotometry(realise(mod, rn), X0, Y0, { r, variance }));
    assert.ok(runs.every(p => p.ok), 'every run measured');
    const snr = mean(runs.map(p => p.snr)), flux = runs.map(p => p.flux);
    assert.ok(Math.abs(snr / exp.snr - 1) < 0.05, `total ${total}, r ${r}: SNR ${snr.toFixed(2)} vs expected ${exp.snr.toFixed(2)}`);
    // the tool's σ is the true scatter of its flux over many noisy copies (that is what makes the SNR honest)
    assert.ok(Math.abs(sd(flux) / exp.noise - 1) < 0.05, `flux scatter ${sd(flux).toFixed(3)} vs predicted σ ${exp.noise.toFixed(3)}`);
    assert.ok(Math.abs(mean(runs.map(p => p.noise)) / exp.noise - 1) < 0.02, 'reported σ = predicted σ');
    assert.equal(runs[0].noiseFrom, 'variance+sky');
  }
});

test('no VARIANCE: sky scatter only, labelled, and close when the sky dominates', () => {
  const mod = model(30), exp = expected(mod, 2), rn = rng(3);
  const runs = Array.from({ length: 400 }, () => S.aperturePhotometry(realise(mod, rn), X0, Y0));
  assert.equal(runs[0].noiseFrom, 'sky');
  assert.ok(Math.abs(mean(runs.map(p => p.snr)) / exp.snr - 1) < 0.05);
  const t = S.snrText(runs[0]);
  assert.match(t.expert.join(' '), /sky scatter only: VARIANCE not loaded/);
});

test('saturated or blanked centres: "SNR not meaningful here"; flagged pixels are left out and counted', () => {
  const mod = model(200), img = realise(mod, rng(1)), fl = new Int32Array(NX * NY);
  const c = Math.round(Y0) * NX + Math.round(X0);
  // SPHEREx blanks an overflowed core (NaN + OVERFLOW): saturated, not "no data"
  const sat = { ...img, data: Float64Array.from(img.data) }; sat.data[c] = NaN; const fs = Int32Array.from(fl); fs[c] = 2;
  const p = S.aperturePhotometry(sat, X0, Y0, { flags: { data: fs }, flagNames: FLAGS });
  assert.equal(p.ok, false); assert.equal(p.reason, 'saturated');
  assert.equal(S.snrText(p).line, 'SNR not meaningful here (centre saturated)');
  const bl = { ...img, data: Float64Array.from(img.data) }; bl.data[c] = NaN;
  assert.equal(S.aperturePhotometry(bl, X0, Y0).reason, 'blanked');
  const fh = Int32Array.from(fl); fh[c + 1] = 1024; fh[c - NX] = 1024 | 2097152; fh[Math.round(Y0) * NX + Math.round(X0) + 6] = 1024; // 2 in the circle, 1 in the sky ring
  const q = S.aperturePhotometry(img, X0, Y0, { flags: { data: fh }, flagNames: FLAGS });
  assert.ok(q.ok); assert.equal(q.nApFlagged, 2); assert.equal(q.nSkyFlagged, 1); assert.equal(q.nApUsed, q.nAp - 2);
  assert.match(S.snrText(q).expert.join(' '), /2 flagged px left out/);
  assert.equal(S.aperturePhotometry(img, 0.4, 0.2).ok, false, 'at the very edge');
});

test('radius is kept to 1–4 px and the sky ring sits 2–6 px outside it', () => {
  const img = realise(model(200), rng(2));
  assert.equal(S.aperturePhotometry(img, X0, Y0, { r: 9 }).r, 4);
  assert.equal(S.aperturePhotometry(img, X0, Y0, { r: 0.2 }).r, 1);
  assert.deepEqual(S.annulusFor(2), [4, 8]);
});

test('stacks: √N, counts per detector and season, plain words and CSV', () => {
  assert.ok(Math.abs(S.stackedSNR(14, 12) - 48.5) < 0.1);
  const frames = [...Array(12)].map((_, k) => ({ detector: 3, mjd: 61000 + k })).concat([...Array(18)].map((_, k) => ({ detector: 3, mjd: 61200 + k })), [{ detector: 4, mjd: 61001 }]);
  const n = S.detectorCounts(frames, { detector: 3, mjd: 61003 }, (m) => (m < 61100 ? 0 : 1));
  assert.deepEqual(n, { season: 0, nSeason: 12, nAll: 30 });
  const t = S.snrText({ ok: true, snr: 14, flux: 1, noise: 1 / 14, r: 2, rIn: 4, rOut: 8, nApUsed: 13, nApFlagged: 0, nSky: 150, nSkyFlagged: 0, bg: 1, sigmaSky: 0.1, varSum: 0.1, skyErr2: 0.01, noiseFrom: 'variance+sky' }, n, { detector: 3 });
  // season pictures are medians: √(2n/π), not √n (14 × √(24/π) = 38.7, 14 × √(60/π) = 61.2)
  assert.equal(t.simple, "Signal-to-noise 14: clearly real. Stacking this season's 12 images from detector 3: about 39. All 30 images from detector 3 combined: about 61.");
  assert.ok(Math.abs(S.medianStackedSNR(14, 12) - 38.70) < 0.05);
  assert.match(t.expert[0], /^SNR = F \/ σ/);
  assert.equal(S.snrWord(4), 'faint: probably real, but check other images'); assert.equal(S.snrWord(2), 'not clearly above the noise');
  const row = S.csvRow({ ok: true, snr: 14, x: 1, y: 2, r: 2, rIn: 4, rOut: 8, nApUsed: 13, nApFlagged: 0, nSky: 150, bg: 1, sigmaSky: 0.1, varSum: 0.1, skyErr2: 0.01, flux: 1, noise: 0.0714, noiseFrom: 'sky' }, { target: "Barnard's Star, x", obsid: 'O1', mjd: 61000.5, detector: 3 }, n);
  assert.equal(row.split(',').length - 1, S.CSV_HEAD.split(',').length, 'one extra comma for the quoted name');
  assert.ok(row.startsWith('"Barnard\'s Star, x",O1,61000.5,3,'));
});

test('the five saved targets give sensible answers on their real pre-baked cutouts', () => {
  const out = {};
  for (const p of PRESETS) {
    const dir = new URL(`../web/prebaked/${p.key}/`, import.meta.url);
    const files = readdirSync(dir).filter(f => f.endsWith('.fits'));
    const res = { ok: [], saturated: 0, other: 0, n: 0 };
    for (const f of files) {
      const b = readFileSync(new URL(f, dir)); let c;
      try { c = decodeCutout(new Uint8Array(b.buffer, b.byteOffset, b.length)); } catch { continue; }
      const pos = (p.target.pmra || p.target.pmdec) ? propagate(p.target, c.mjd) : p.target;
      const [x, y] = c.wcs.worldToPix(pos.ra, pos.dec);
      const q = S.aperturePhotometry(c.image, x, y, { flags: c.flags, flagNames: c.flagNames });
      res.n++;
      if (q.ok) { assert.ok(Number.isFinite(q.snr) && q.noise > 0 && q.nApUsed > 0); res.ok.push(q.snr); } else if (q.reason === 'saturated') res.saturated++; else res.other++;
    }
    const med = res.ok.length ? res.ok.slice().sort((a, b) => a - b)[res.ok.length >> 1] : NaN;
    out[p.key] = { n: res.n, ok: res.ok.length, sat: res.saturated, other: res.other, med };
  }
  // Barnard's Star (J 5.2) and R Draconis (a Mira, K about −1) saturate SPHEREx at every wavelength
  for (const k of ['barnard', 'r-dra']) assert.ok(out[k].sat >= 0.9 * out[k].n, `${k}: ${JSON.stringify(out[k])}`);
  // RW Aurigae (K about 7) saturates in most images
  assert.ok(out['rw-aur'].sat > out['rw-aur'].n / 2, JSON.stringify(out['rw-aur']));
  // Epsilon Indi B (J about 12): unsaturated and very clearly detected
  assert.ok(out['eps-indi-b'].ok >= 0.9 * out['eps-indi-b'].n && out['eps-indi-b'].med > 50, JSON.stringify(out['eps-indi-b']));
  // WISE 0855: measured almost everywhere, a modest SNR (faint in single images)
  assert.ok(out['wise-0855'].ok >= 0.9 * out['wise-0855'].n && out['wise-0855'].med > 1 && out['wise-0855'].med < 30, JSON.stringify(out['wise-0855']));
});

// Full Function Test (live): WISE 0855 below 3.8 µm is not detected (Brightness panel / Proof), and the saved Gaia
// neighbour sits inside the 2 px circle, so the SNR line names that star and never says "clearly real".
test('not the target: a background star inside the circle is named from proof.json, with no "clearly real" and no projection', async () => {
  const proof = JSON.parse(readFileSync(new URL('../web/data/proof.json', import.meta.url), 'utf8'));
  const t = proof.targets.find(q => /0855/.test(q.name)), nb = t.extra.neighbours.slice().sort((a, b) => a.g - b.g)[0];
  const p = fake(12.4);
  const x = S.snrText(p, counts, { detector: 2, notTarget: { name: t.label, src: { g: nb.g, sepArcsec: nb.sepArcsec } } });
  assert.equal(x.line, `Most of this light is a background star ${nb.sepArcsec.toFixed(1)}″ away (Gaia G ${nb.g.toFixed(1)}), not ${t.label}.`);
  assert.doesNotMatch(x.line + x.simple + x.expert.join(' '), /clearly real|Stacking this season|Median stacks/);
  assert.match(x.expert.join(' '), /Not the target: .* inside r = 12\.3″/);
  // the neighbour outside a 1 px (6.15″) circle: no blame on it, but still not the target
  const y = S.snrText({ ...p, r: 1 }, counts, { notTarget: { name: t.label, src: { g: nb.g, sepArcsec: nb.sepArcsec } } });
  assert.match(y.line, new RegExp(`^This light is not ${t.label}`)); assert.doesNotMatch(y.simple, /clearly real/);
  // and the rule the viewer uses: the Brightness panel's own groups for the real WISE 0855 short band say absent
  const { notHereText } = await import('../web/app/lightcurve/logic.js');
  assert.match(notHereText({ state: 'offset' }, null, { g: nb.g, sepArcsec: nb.sepArcsec }, t.label, 'below 3.8 µm'), /background star/);
});

// Judging panel round 7 (SNR honesty): no projection from noise, the sky-limited note, stacks measured not projected.
const fake = (snr, extra = {}) => ({ ok: true, snr, flux: snr, noise: 1, r: 2, rIn: 4, rOut: 8, nApUsed: 13, nApFlagged: 0, nSky: 150, nSkyFlagged: 0, bg: 1, sigmaSky: 0.1, varSum: 0.9, skyErr2: 0.1, noiseFrom: 'sky', ...extra });
const counts = { nSeason: 12, nAll: 30 };

test('single-image SNR < 3: no stacking projection, "No detectable source here"', () => {
  for (const s of [2.9, 1.2, 0]) {
    const t = S.snrText(fake(s), counts, { detector: 3 });
    assert.match(t.line, /^No detectable source here/);
    assert.doesNotMatch(t.simple, /Stacking this season|combined: about/);
    assert.doesNotMatch(t.expert.join(' '), /Median stacks|SNR × √/);
    assert.match(t.expert.join(' '), /No stacking projection: single-image SNR .* < 3/);
    const row = S.csvRow(fake(s), {}, counts).split(','), h = S.CSV_HEAD.split(',');
    assert.equal(row[h.indexOf('snr_season_det')], ''); assert.equal(row[h.indexOf('snr_all_det')], '');
  }
  const ok = S.snrText(fake(3), counts, { detector: 3 });
  assert.match(ok.line, /^Signal-to-noise 3/); assert.match(ok.simple, /Stacking this season's 12 images/);
});

test('blank sky (a negative flux) gives "No detectable source", never a negative stacked SNR', () => {
  const t = S.snrText(fake(-1.7, { flux: -1.7 }), counts, { detector: 5 });
  assert.equal(t.line, 'No detectable source here (signal-to-noise -1.7).');
  assert.doesNotMatch(t.simple + t.expert.join(' '), /about -|→ -/);
  assert.match(t.simple, /doesn't create a source/);
  // real pixels: pure sky noise with a dip where the "star" would be
  const r = rng(11), img = { nx: NX, ny: NY, data: Float64Array.from({ length: NX * NY }, () => SKY + SKY_SIG * gauss(r)) };
  for (let j = 18; j <= 21; j++) for (let i = 19; i <= 22; i++) img.data[j * NX + i] -= 2;
  const p = S.aperturePhotometry(img, X0, Y0);
  assert.ok(p.ok && p.flux < 0 && p.snr < 0);
  assert.match(S.snrText(p, counts).line, /^No detectable source here/);
});

test("sky-limited note: the exact phrase in Expert when the star's own noise is not in σ; none with VARIANCE", () => {
  const sky = S.snrText(fake(20), counts, { detector: 3 });
  assert.ok(sky.expert.includes("Note: sky-limited estimate; ignores the star's own (photon) noise"));
  assert.match(S.SKY_LIMITED_SIMPLE, /star's own light/);
  const v = S.snrText(fake(20, { noiseFrom: 'variance+sky' }), counts, { detector: 3 });
  assert.ok(!v.expert.some(l => /sky-limited/.test(l)));
  // a stack on screen is measured on its own pixels, not projected
  const st = S.snrText(fake(40), counts, { stack: true });
  assert.doesNotMatch(st.simple, /Stacking/); assert.match(st.expert.join(' '), /Measured on the stacked \(median\) picture itself/);
  assert.match(S.snrText({ ok: false, reason: 'blanked' }, {}, { stack: true }).line, /centre blanked in the stack: saturated or no good data/);
  // a median stack hides a saturated core: its own images say so
  const n = 9, clean = { n, data: Array(n * n).fill(1) }, holed = { n, data: Array(n * n).fill(1) }; holed.data[4 * n + 4] = null;
  assert.equal(S.mostlyBlanked([holed, holed, clean], 4, 4), true);
  assert.equal(S.mostlyBlanked([holed, clean, clean], 4, 4), false);
  assert.match(S.snrText({ ok: false, reason: 'saturated' }, {}, { stack: true }).line, /saturated or blanked in most images of this stack/);
});

// Judging panel round 9, item 2: SNR must agree with the verdict.
test("Spot: an artefact / nothing verdict never sits under 'clearly real' or a stacking projection", () => {
  const p = fake(48);
  for (const [v, why] of [[{ kind: 'artefact', title: 'Likely artefact', decidedBy: 'flags' }, /most likely an artefact \(flagged pixels\)/],
    [{ kind: 'artefact', title: 'Likely artefact', decidedBy: 'seasons' }, /most likely an artefact \(not a clear dot in both seasons\)/],
    [{ kind: 'artefact', title: 'Not a separate dot', decidedBy: 'seasons' }, /outer glow of a brighter source/],
    [{ kind: 'nothing', title: 'Nothing here' }, /no dot that stands out/]]) {
    const t = S.snrText(p, counts, { detector: 3, verdict: v });
    assert.match(t.line, /^Signal-to-noise 48 at this pixel, but the checks/); assert.match(t.line, why);
    assert.doesNotMatch(t.line + t.simple + t.expert.join(' '), /clearly real|Stacking this season|Median stacks|combined: about/);
    assert.equal(t.detection, false);
  }
  // other verdicts leave the line alone
  for (const kind of ['unexplained', 'known-star', 'known-asteroid', 'pending']) assert.match(S.snrText(p, counts, { verdict: { kind } }).line, /clearly real/);
  // the card renders with the verdict of the moment (not a line cached before the verdict landed)
  const spot = readFileSync(new URL('../web/app/spot/main.js', import.meta.url), 'utf8');
  assert.match(spot, /spotSnrRender\(s\.snr, s\.verdict\)/);
});

test('WISE 0855 below 3.8 µm: all-band stacks and clicks near the target follow the Brightness panel', () => {
  const nb = { g: 16.31, sepArcsec: 7.8 };
  const groups = [{ id: 'short', dets: [1, 2, 3, 4], absent: true, src: nb }, { id: 'long', dets: [5, 6], absent: false }];
  assert.deepEqual(S.notTargetFor(groups, [2, 3], 'WISE 0855'), { name: 'WISE 0855', src: nb });
  assert.equal(S.notTargetFor(groups, [5, 6], 'WISE 0855'), null);
  const mixed = S.notTargetFor(groups, [1, 2, 5, 6], 'WISE 0855');
  assert.equal(mixed.mixed, true); assert.equal(mixed.where, 'below 3.8 µm');
  const t = S.snrText(fake(17), counts, { stack: true, notTarget: mixed });
  assert.match(t.line, /^Signal-to-noise 17, but part of this light is a background star 7\.8″ away \(Gaia G 16\.3\): WISE 0855 is not detected below 3\.8 µm/);
  assert.doesNotMatch(t.line + t.simple, /clearly real/);
  // a clicked point counts as the target within the circle plus one pixel (2 px circle: 18.45″)
  assert.equal(S.nearTarget(10, 2), true); assert.equal(S.nearTarget(18.4, 2), true); assert.equal(S.nearTarget(19, 2), false);
  const ui = readFileSync(new URL('../web/app/snr-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /atStar \? notTarget\(\[f\.detector\]\) : null/); assert.match(ui, /notTargetFor\(await targetGroups/);
});

test("help sentence: 'adding more images raises it' only for a detection (snr-ui.js, round 9)", () => {
  const ui = readFileSync(new URL('../web/app/snr-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /t\.detection \? SIMPLE_WHY : SIMPLE_WHY_NONE/);
  assert.match(ui, /SIMPLE_WHY_NONE = 'It compares the light in a small circle here with the random flicker of the sky around it\.'/);
  assert.equal(S.snrText(fake(1.2), counts).detection, false);
  assert.equal(S.snrText(fake(20), counts).detection, true);
  assert.equal(S.snrText(fake(20), counts, { notTarget: { name: 'X' } }).detection, false);
});
