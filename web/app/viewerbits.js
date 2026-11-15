// Pure helpers for the viewer (ui.js): "Hold one band" groups, the image counter, the result
// plate (caption + measured chip) and the share link. No DOM, so tests/viewerbits.test.mjs can run them.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

export const PIXEL_ARCSEC = 6.15;

// SPHEREx detectors in pairs (Explanatory Supplement v2.0 ranges, rounded for the label).
export const BAND_GROUPS = [
  { id: 'd12', dets: [1, 2], label: '0.75–1.65 µm' },
  { id: 'd34', dets: [3, 4], label: '1.65–3.8 µm' },
  { id: 'd56', dets: [5, 6], label: '3.8–5.0 µm' },
];
export const groupOfDet = det => BAND_GROUPS.find(g => g.dets.includes(det)) || null;
export const groupByDets = dets => (Array.isArray(dets) ? BAND_GROUPS.find(g => g.dets.length === dets.length && g.dets.every(d => dets.includes(d))) : null) || null;

// Is any pixel within r pixels of (x, y) blanked (null / not finite)? Same test as data.js trackPoint.
export function centreMasked(d, n, x, y, r = 2) {
  if (!d || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++) for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
    if (i >= 0 && j >= 0 && i < n && j < n && Math.hypot(i - x, j - y) <= r && !Number.isFinite(d[j * n + i])) return true;
  }
  return false;
}

// The band group whose images most often show the star's centre unblanked: lowest fraction of
// blanked centres, ties to the group with more images. frames: [{ det, masked }]. Groups with
// fewer than minFrames images are skipped. Returns { group, n, masked } or null.
export function bestGroup(frames, minFrames = 6) {
  let best = null;
  for (const g of BAND_GROUPS) {
    const fs = frames.filter(f => g.dets.includes(f.det)), n = fs.length;
    if (n < minFrames) continue;
    const m = fs.filter(f => f.masked).length, c = { group: g, n, masked: m, frac: m / n };
    if (!best || c.frac < best.frac - 1e-9 || (Math.abs(c.frac - best.frac) <= 1e-9 && c.n > best.n)) best = c;
  }
  return best;
}

// The counter under Play. i = index in the shown list.
//  loading: "6 / 120 · 84 loaded" (position in the planned sequence, so it never jumps when an
//           earlier image arrives late; the same while one band is held)
//  ready:   "15 / 120 (of 358)" when IRSA has more than we used; held: "6 / 47"
export function counterText({ i, shown, loading, planned, loaded, total, plannedIndex, held }) {
  if (!shown) return loading && planned ? `0 / ${planned} · ${loaded || 0} loaded` : '';
  const k = i + 1;
  if (loading) { // also with one band held: the place in the whole planned sequence
    const n = Number.isFinite(plannedIndex) && plannedIndex >= 0 ? plannedIndex + 1 : k;
    return `${n} / ${planned} · ${loaded} loaded`;
  }
  if (held) return `${k} / ${shown}`;
  return `${k} / ${shown}${total > shown ? ` (of ${total})` : ''}`;
}

// Index of mjd in a planned list (nearest within 0.01 d), or -1.
export function plannedIndexOf(mjds, mjd) {
  if (!mjds?.length || !Number.isFinite(mjd)) return -1;
  let b = -1, bd = 0.01;
  for (let k = 0; k < mjds.length; k++) { const d = Math.abs(mjds[k] - mjd); if (d < bd) { bd = d; b = k; } }
  return b;
}

const VERDICT_CLASS = { 'AGREES': 'agrees', 'AT THE LIMIT': 'limit', 'DIFFERS': 'differs', 'NOT MEASURABLE': 'nm' };
export const verdictClass = v => VERDICT_CLASS[v] || 'nm';

// The measured chip's state from the fit (mas/yr values). mo = measureMotion() result (or null),
// measurable = data.js motionMeasurability(...).measurable (true when no rule applies),
// verdict = proof/logic.js motionVerdict(...).verdict or null (no catalogue value), catYr = catalogue ″/yr or null.
// Returns { kind: 'value' | 'none' | 'nm' | 'fail', value, cat, verdict }.
export function resultState({ mo, measurable, verdict, catYr }) {
  if (!mo?.ok) return { kind: 'fail', reason: mo?.reason || null };
  if (measurable === false || verdict === 'NOT MEASURABLE') return { kind: 'nm', verdict: 'NOT MEASURABLE', cat: catYr };
  const value = mo.significant === false
    ? `no significant motion (< ${(mo.upperLimit / 1000).toFixed(2)}″/yr)`
    : `${(mo.total / 1000).toFixed(2)} ± ${(mo.totalErr / 1000).toFixed(2)}″/yr`;
  return { kind: mo.significant === false ? 'none' : 'value', value, cat: catYr, verdict: Number.isFinite(catYr) ? verdict : null };
}

// The Blink caption: "{name} moved {d}″ in {t} years, about {px} pixels." from the measured motion
// (mas/yr) over the time between the first and last season stacks (their mid-dates, MJD).
// Only for a significant, measurable motion; null otherwise (the chip alone speaks).
export function storyCaption(name, mo, mjdA, mjdB) {
  if (!mo?.ok || mo.significant === false || !Number.isFinite(mjdA) || !Number.isFinite(mjdB) || mjdB <= mjdA) return null;
  const t = (mjdB - mjdA) / 365.25, d = mo.total / 1000 * t, px = d / PIXEL_ARCSEC;
  return { t, d, px, text: `${name} moved ${d.toFixed(1)}″ in ${t.toFixed(1)} years, about ${px.toFixed(1)} pixels.` };
}

// The share link: target (q, or ra + dec), scene, view mode and the image date.
export function shareParams({ q, ra, dec, scene, mode, mjd }) {
  const p = new URLSearchParams();
  if (q) p.set('q', q); else if (Number.isFinite(ra) && Number.isFinite(dec)) { p.set('ra', ra.toFixed(5)); p.set('dec', dec.toFixed(5)); }
  if (scene === 'viewer') {
    p.set('scene', 'viewer');
    if (mode && mode !== 'play') p.set('view', mode);
    if (Number.isFinite(mjd) && (!mode || mode === 'play')) p.set('mjd', mjd.toFixed(4));
  }
  return p;
}
export const VIEW_MODES = ['play', 'compare', 'blink', 'telescopes'];
