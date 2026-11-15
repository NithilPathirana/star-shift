// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Spot's 5th check, "Colour (estimate)" (judging panel item 9). Pure: no DOM, no network.
// It is SUPPORTING EVIDENCE only: decideVerdict (logic.js) never sees it, and withColour() below only
// appends one evidence line to a verdict that is already decided.
//
// Measurement. For the clicked dot, in the season the dot was measured in, every SPHEREx image of that
// season (all six detectors, not only the blinked ones) gets aperture photometry at the dot's centre:
// a 2 px (12.3″) circle with fractional pixel edges, minus the median of a local sky ring 4-8 px out
// (3σ-clipped; noise = the ring's robust scatter), as tools/botha_check.mjs measures. An image with a
// masked pixel inside the circle is skipped (the archive blanks saturated pixels, so a saturated star
// gives no number, never a wrong one; the brightness chart's rule). 2 px holds over 98% of the light for
// every detector's PSF (σ 0.51-0.69 px, data.js PSF_SIGMA_PX), so the bands lose the same share.
// Surface brightness (MJy/sr) × pixel solid angle -> Fν in mJy (lightcurve/logic.js toMilliJy).
// Each image sees one wavelength, so the images fall into three groups by detector:
//   S = 0.75-2.4 µm (detectors 1-3), M = 2.4-3.8 µm (detector 4, holds the 3.3 µm methane band),
//   L = 3.8-5.0 µm (detectors 5-6, holds the 4.5 µm window where cold brown dwarfs are brightest).
// Group flux = plain mean of the images' Fν; its error = the larger of the noise-only error and the
// standard error of the scatter left after a straight line in wavelength (the source's own colour
// across a group is not noise). The colour is R = L / S (an Fν ratio) with its propagated error.
//
// Physics (the boundaries; NOT fitted to any target). Every model is averaged at the SAME wavelengths
// the images saw, the same way as the data, so a boundary is "what that physics gives here".
//  - Stars: a photosphere is close to a blackbody. Hot stars sit on the Rayleigh-Jeans tail
//    (Fν ∝ λ⁻², R ≈ 0.1); the coolest hydrogen-burning stars are about 2300 K (the M/L boundary).
//    So R_STAR = R of a 2300 K blackbody: anything bluer (at +2σ) is star-like.
//  - Redder than any star (R > R_STAR at −2σ) needs something cold. x = M / S, and inside the long group
//    t = F(4.4-5.0 µm, detector 6) / F(3.8-4.4 µm, detector 5).
//    · Red AND x > X_STAR (x of a 2300 K blackbody: the light already rises through 2.4-3.8 µm) is
//      neither class: warm dust, as round a young star such as RW Aurigae. Said as "can't tell".
//    · Red with a dip at 2.4-3.8 µm (x ≤ X_STAR) is a brown dwarf (methane near 3.3 µm, water near
//      2.7 µm) or an asteroid (sunlight, falling with wavelength, before its thermal glow takes over).
//      The long group tells them apart: an asteroid's surface is at most ~600 K (sub-solar point at
//      0.5 AU), so its glow is on the Wien side at 4-5 µm and keeps RISING steeply to 5 µm, t ≥ t of a
//      600 K blackbody. A cold brown dwarf's 4-5 µm window PEAKS near 4.5 µm (CO and water close it
//      beyond 4.6 µm), so t stays below that. (Version 1 used the 0.75-1.1 vs 1.6-2.4 µm shape; the
//      measured Epsilon Indi B showed early T dwarfs are bright at 1.0-1.1 µm, so that split was
//      physically unsafe and was dropped before any target was run with this rule.)
//    · Light at 3.8-5.0 µm with none at 0.75-2.4 µm: a cold brown dwarf (an asteroid shows its sunlight).
//  - Every decision is made at both ends of the 2σ range; if they disagree: "too faint to tell".
//    Neither group seen at 5σ: "too faint to tell". Saturated (every image blanked in a group): "can't tell".

import { toMilliJy, GRID_ARCSEC } from '../lightcurve/logic.js';

export const AP_PX = 2;            // aperture radius (grid px, 6.15″ each)
export const SKY_IN_PX = 4, SKY_OUT_PX = 8;
export const MIN_SNR = 5;          // a group counts as seen at 5σ
export const NSIG = 2;             // decisions hold at both ends of ±2σ
export const T_COOLEST_STAR = 2300; // K: the hydrogen-burning limit (M/L boundary)
export const T_SUN = 5778;          // K
export const COLOUR_GROUPS = [
  { id: 'S', name: '0.75–2.4 µm', dets: [1, 2, 3] },
  { id: 'M', name: '2.4–3.8 µm', dets: [4] },
  { id: 'L', name: '3.8–5.0 µm', dets: [5, 6] },
];
// sub-groups inside L for the long-side shape (t = L6 / L5)
export const SUB_GROUPS = [{ id: 'L5', name: '3.8–4.4 µm', dets: [5] }, { id: 'L6', name: '4.4–5.0 µm', dets: [6] }];
export const groupOf = (det) => COLOUR_GROUPS.find(g => g.dets.includes(Number(det)))?.id ?? null;
export const T_HOTTEST_ASTEROID = 600; // K: sub-solar temperature at 0.5 AU

const median = (a) => { const s = a.slice().sort((p, q) => p - q), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };

// Local sky: median and robust scatter of the ring, 3σ-clipped (stars, cosmic rays).
export function skyRing(vals) {
  let a = vals, mid = NaN, sig = NaN;
  for (let it = 0; it < 5; it++) {
    mid = median(a); sig = 1.4826 * median(a.map(v => Math.abs(v - mid)));
    const b = vals.filter(v => Math.abs(v - mid) <= 3 * sig);
    if (b.length === a.length) break;
    a = b;
  }
  return { sky: mid, sigma: sig, n: a.length };
}

// One image: { mJy, err, masked } at grid position (x, y), or null when the circle or ring leaves the image.
// frame: { n, data (MJy/sr, NaN = masked), pixArcsec? }.
export function apPhot(frame, x, y, { r = AP_PX, skyIn = SKY_IN_PX, skyOut = SKY_OUT_PX } = {}) {
  const n = frame?.n, data = frame?.data;
  if (!n || !data || !(x - r >= -0.5 && y - r >= -0.5 && x + r <= n - 0.5 && y + r <= n - 0.5)) return null;
  const ring = [];
  for (let j = Math.floor(y - skyOut); j <= Math.ceil(y + skyOut); j++) for (let i = Math.floor(x - skyOut); i <= Math.ceil(x + skyOut); i++) {
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const d = Math.hypot(i - x, j - y), v = data[j * n + i];
    if (d >= skyIn && d <= skyOut && Number.isFinite(v)) ring.push(v);
  }
  if (ring.length < 12) return null;
  const { sky, sigma, n: nSky } = skyRing(ring);
  let sum = 0, area = 0, masked = 0;
  for (let j = Math.floor(y - r - 1); j <= Math.ceil(y + r + 1); j++) for (let i = Math.floor(x - r - 1); i <= Math.ceil(x + r + 1); i++) {
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    let w = 0; // share of the pixel inside the circle (10 × 10 sub-pixels)
    for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) if (Math.hypot(i - 0.45 + a * 0.1 - x, j - 0.45 + b * 0.1 - y) <= r) w++;
    if (!w) continue;
    w /= 100;
    const v = data[j * n + i];
    if (!Number.isFinite(v)) { masked++; continue; }
    sum += w * (v - sky); area += w;
  }
  if (masked) return { masked, mJy: null, err: null };
  const noise = sigma * Math.sqrt(area + (Math.PI / 2) * area * area / nSky);
  const pix = frame.pixArcsec ?? GRID_ARCSEC;
  return { masked: 0, mJy: toMilliJy(sum, pix), err: toMilliJy(noise, pix) };
}

// frames of one season (all detectors); (x, y): the dot on the display grid.
// Returns { rows: [{ det, wl, group, mJy, err, masked }], groups: { S, M, L } }, each group
// { n, used, masked, mean, err, snr, wls } (mean/err in mJy; null when nothing usable).
export function measureColour(frames, x, y, opts = {}) {
  const rows = [];
  for (const f of frames || []) {
    const g = groupOf(f.detector); if (!g || !Number.isFinite(f.wavelengthUm)) continue;
    const m = apPhot(f, x, y, opts); if (!m) continue;
    rows.push({ det: Number(f.detector), wl: f.wavelengthUm, group: g, ...m });
  }
  return { rows, groups: summarise(rows) };
}
export function summarise(rows) {
  const out = {};
  for (const G of [...COLOUR_GROUPS, ...SUB_GROUPS]) {
    const mine = rows.filter(r => G.dets.includes(r.det)), ok = mine.filter(r => !r.masked && Number.isFinite(r.mJy));
    const k = ok.length;
    let mean = null, err = null;
    if (k) {
      mean = ok.reduce((a, r) => a + r.mJy, 0) / k;
      const noiseErr = Math.sqrt(ok.reduce((a, r) => a + r.err * r.err, 0)) / k;
      err = Math.max(noiseErr, residualSd(ok) / Math.sqrt(k));
    }
    out[G.id] = { id: G.id, name: G.name, n: mine.length, used: k, masked: mine.length - k, mean, err, snr: k && err > 0 ? mean / err : null, wls: ok.map(r => r.wl) };
  }
  return out;
}

// Scatter about a straight line in wavelength: the source's real colour across a group is not noise,
// what is left over (cosmic rays, a neighbour's wing, bad sky) is. 0 with fewer than 4 images.
function residualSd(rows) {
  const k = rows.length; if (k < 4) return 0;
  const mw = rows.reduce((a, r) => a + r.wl, 0) / k, mf = rows.reduce((a, r) => a + r.mJy, 0) / k;
  let sww = 0, swf = 0; for (const r of rows) { sww += (r.wl - mw) ** 2; swf += (r.wl - mw) * (r.mJy - mf); }
  const slope = sww > 0 ? swf / sww : 0;
  return Math.sqrt(rows.reduce((a, r) => a + (r.mJy - mf - slope * (r.wl - mw)) ** 2, 0) / (k - 2));
}

// ---------------------------------------------------------------- physics models
// Planck Fν shape (arbitrary scale); λ in µm. hc/k = 14387.77 µm·K.
export const planckNu = (um, T) => um ** -3 / Math.expm1(14387.77 / (um * T));
// A model's group mean at the very wavelengths that were measured (the same plain mean as the data).
export const modelMean = (fn, wls) => (wls.length ? wls.reduce((a, w) => a + fn(w), 0) / wls.length : NaN);
// The boundaries for these wavelengths: R and x of the coolest star, plus reference values to show.
export function boundaries(wl) {
  const S = wl.S || [], M = wl.M || [], L = wl.L || [];
  const ratio = (fn, top, bot) => modelMean(fn, top) / modelMean(fn, bot);
  const bb = (T) => (um) => planckNu(um, T), rj = (um) => um ** -2;
  return {
    rStar: ratio(bb(T_COOLEST_STAR), L, S), xStar: M.length ? ratio(bb(T_COOLEST_STAR), M, S) : null,
    rHot: ratio(rj, L, S), rSun: ratio(bb(T_SUN), L, S), xSun: M.length ? ratio(bb(T_SUN), M, S) : null,
    tWarm: wl.L5?.length && wl.L6?.length ? ratio(bb(T_HOTTEST_ASTEROID), wl.L6, wl.L5) : null,
  };
}
// Uniformly sampled band wavelengths, for tests and the Expert text when no images are at hand.
export function bandGrid(min, max, k = 24) { return Array.from({ length: k }, (_, i) => min + (max - min) * (i + 0.5) / k); }
export const NOMINAL_WL = { S: bandGrid(0.75, 2.42), M: bandGrid(2.42, 3.82), L: bandGrid(3.82, 5.0), L5: bandGrid(3.82, 4.42), L6: bandGrid(4.42, 5.0) };

// ---------------------------------------------------------------- the classifier
export const COLOUR_TEXT = {
  star: 'colour looks like a star',
  'brown-dwarf': 'colour looks like a cold brown dwarf (very red at 4–5 µm)',
  asteroid: 'colour looks like an asteroid (sunlight + warmth)',
  faint: 'too faint to tell',
  saturated: "can't tell: the centre is saturated (too bright)",
  'no-split': "can't tell: red, but the images here can't split brown dwarf from asteroid",
  dust: "can't tell: red, rising smoothly through 2.4–3.8 µm (like warm dust round a young star)",
};
export const COLOUR_LABEL = 'Colour (estimate)';

// groups: summarise() output. Returns { cls, text, R, rErr, x, xErr, b (boundaries), why }.
export function classifyColour(groups) {
  const S = groups.S, M = groups.M, L = groups.L;
  const b = boundaries({ S: S?.wls || [], M: M?.wls || [], L: L?.wls || [], L5: groups.L5?.wls || [], L6: groups.L6?.wls || [] });
  const out = (cls, why, extra = {}) => ({ cls, text: COLOUR_TEXT[cls], why, b, ...extra });
  const seen = (g) => !!g && g.used > 0 && g.snr >= MIN_SNR;
  const sat = (g) => !!g && g.n > 0 && g.used === 0;
  if (sat(S) || sat(L)) return out('saturated', `every ${sat(S) ? S.name : L.name} image has a blanked (saturated) pixel in the measuring circle`);
  if (!S?.used || !L?.used) return out('faint', 'no usable image in one of the two groups');
  if (!seen(S) && !seen(L)) return out('faint', `neither group stands ${MIN_SNR}× above the noise`);
  // R and its ±2σ ends (S at or below zero: R has no upper end, only a lower one)
  const R = S.mean > 0 ? L.mean / S.mean : Infinity;
  const rErr = S.mean > 0 && L.mean > 0 ? R * Math.hypot(L.err / L.mean, S.err / S.mean) : null;
  const sHi = S.mean + NSIG * S.err, lLo = L.mean - NSIG * L.err, lHi = L.mean + NSIG * L.err, sLo = S.mean - NSIG * S.err;
  const rLo = sHi > 0 ? Math.max(0, lLo) / sHi : 0, rHi = sLo > 0 ? lHi / sLo : Infinity;
  const x = M?.used && S.mean > 0 ? M.mean / S.mean : null;
  const xErr = x != null && M.mean > 0 ? x * Math.hypot(M.err / M.mean, S.err / S.mean) : null;
  const vals = { R, rErr, rLo, rHi, x, xErr };
  if (rHi <= b.rStar) return out('star', `R stays below a ${T_COOLEST_STAR} K blackbody's ${b.rStar.toFixed(2)} even at +${NSIG}σ`, vals);
  if (rLo <= b.rStar) return out('faint', `R's ±${NSIG}σ range straddles the coolest-star line (${b.rStar.toFixed(2)})`, vals);
  // redder than any star: brown dwarf, warm asteroid, or warm dust, by the short-side shape and the middle
  if (!seen(S)) return out('brown-dwarf', 'light at 3.8–5.0 µm but none above the noise at 0.75–2.4 µm (an asteroid would show its sunlight)', vals);
  const ends = (top, bot) => (top?.used && bot?.used && bot.mean > 0 ? { v: top.mean / bot.mean, lo: Math.max(0, top.mean - NSIG * top.err) / (bot.mean + NSIG * bot.err), hi: bot.mean - NSIG * bot.err > 0 ? (top.mean + NSIG * top.err) / (bot.mean - NSIG * bot.err) : Infinity } : null);
  const xe = ends(M, S), te = ends(groups.L6, groups.L5);
  vals.t = te?.v ?? null;
  if (!xe || b.xStar == null) return out('no-split', `redder than any star (R > ${b.rStar.toFixed(2)} at −${NSIG}σ): something cold glows at 3.8–5.0 µm, but there is no 2.4–3.8 µm image here to tell a brown dwarf's methane dip from an asteroid's sunlight`, vals);
  if (xe.lo > b.xStar) return out('dust', `the 2.4–3.8 µm light is already redder than a ${T_COOLEST_STAR} K star (x > ${b.xStar.toFixed(2)}): a smooth warm rise, not a methane dip and not sunlight`, vals);
  if (xe.hi > b.xStar) return out('faint', `the 2.4–3.8 µm colour's ±${NSIG}σ range straddles the coolest-star line (${b.xStar.toFixed(2)})`, vals);
  if (!te || b.tWarm == null) return out('no-split', 'no usable 3.8–4.4 µm or 4.4–5.0 µm image', vals);
  if (te.lo >= b.tWarm) return out('asteroid', `redder than any star, a dip at 2.4–3.8 µm, and the light still rising steeply to 5 µm like a surface of ${T_HOTTEST_ASTEROID} K or colder (t ≥ ${b.tWarm.toFixed(2)})`, vals);
  if (te.hi < b.tWarm) return out('brown-dwarf', `redder than any star, a dip at 2.4–3.8 µm, and a 4–5 µm peak rather than a steep warm rise (t < ${b.tWarm.toFixed(2)})`, vals);
  return out('faint', `the 4.4–5.0 vs 3.8–4.4 µm colour's ±${NSIG}σ range straddles the ${T_HOTTEST_ASTEROID} K line (${b.tWarm.toFixed(2)})`, vals);
}

// The estimate for a dot. seasons: [{ label, rows }] from measureColour, the dot's own season FIRST.
// The dot's season alone decides when it can; only when that season is too thin (no image in a group
// that is needed, or not enough light) are the other blinked season's images (measured at the dot's
// place in that season) added, and the result says so.
export function colourEstimate(seasons) {
  const own = seasons[0];
  let c = classifyColour(summarise(own.rows)), used = [own.label];
  if ((c.cls === 'no-split' || c.cls === 'faint') && seasons.length > 1) {
    const both = classifyColour(summarise(seasons.flatMap(x => x.rows)));
    if (both.cls !== 'faint' && both.cls !== 'no-split') { c = both; used = seasons.map(x => x.label); }
  }
  return { ...c, seasons: used, groups: summarise((used.length > 1 ? seasons : [own]).flatMap(x => x.rows)) };
}

// ---------------------------------------------------------------- wording
const f2 = (v) => (v == null || !Number.isFinite(v) ? '—' : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
// "R = 0.45 ± 0.03" / "R > 12 (2σ)" / ''
export function ratioText(c) {
  if (c.R == null) return '';
  if (!Number.isFinite(c.R) || c.rErr == null) return c.rLo > 0 ? `R > ${f2(c.rLo)} (${NSIG}σ lower limit)` : '';
  return `R = ${f2(c.R)} ± ${f2(c.rErr)}`;
}
// Simple-mode line and Expert-mode line for the checklist and the verdict's evidence.
// The wavelengths a group really covered here ("1.88–2.02 µm"), else its nominal range.
export function spanText(g, fallback) {
  const w = g?.wls?.filter(Number.isFinite) || [];
  return w.length ? `${Math.min(...w).toFixed(2)}–${Math.max(...w).toFixed(2)} µm` : fallback;
}
export function colourLines(c, season = '') {
  const est = `Estimate: ${c.text}.`;
  const r = ratioText(c), lo = spanText(c.groups?.S, '0.75–2.4 µm'), hi = spanText(c.groups?.L, '3.8–5.0 µm');
  const simple = `${est}${r ? ` Its light at ${hi} is ${Number.isFinite(c.R) ? `${f2(c.R)} times` : 'many times'} its light at ${lo}${c.rErr != null && Number.isFinite(c.R) ? ` (give or take ${f2(c.rErr)})` : ''}.` : ''} A hint only: it never decides the verdict.`;
  const expert = `${est}${r ? ` ${r} (Fν, ${hi} over ${lo}${season ? `, ${season}` : ''}).` : ''}${c.x != null ? ` x = M/S = ${f2(c.x)}${c.xErr != null ? ` ± ${f2(c.xErr)}` : ''}.` : ''}${c.t != null ? ` t = ${f2(c.t)}.` : ''} Why: ${c.why}. Lines at these wavelengths: Rayleigh-Jeans star ${f2(c.b.rHot)}, sunlight ${f2(c.b.rSun)}, coolest star (${T_COOLEST_STAR} K blackbody) ${f2(c.b.rStar)}${c.b.xStar != null ? `; x of the coolest star ${f2(c.b.xStar)}, of sunlight ${f2(c.b.xSun)}` : ''}${c.b.tWarm != null ? `; t of a ${T_HOTTEST_ASTEROID} K surface ${f2(c.b.tWarm)}` : ''}. Supporting evidence only; it never changes the verdict.`;
  return { simple, expert };
}

// The verdict with the colour appended to its evidence list; nothing else changes (kind, title, sub,
// body, decidedBy stay exactly as decideVerdict made them). A pending verdict is returned untouched.
export function withColour(verdict, colour) {
  if (!verdict || verdict.kind === 'pending' || !colour?.text) return verdict;
  return { ...verdict, evidence: [...(verdict.evidence || []), `${COLOUR_LABEL}: ${colour.text}${ratioText(colour) ? ` (${ratioText(colour)})` : ''}.`] };
}
