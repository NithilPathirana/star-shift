// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Atmosphere lens maths (DESIGN.md 31b): how much infrared light gets through the air from a
// place, from REAL sky-transmission curves (Gemini Observatory ATRAN models, Lord 1992; see
// web/data/atran/README.md). Pure functions, no DOM: used by the page and by tests/atran.test.mjs.

export const RULER = { min: 0.74, max: 5.01 }; // SPHEREx range, as the other rulers (17b, 29)

// The one-number rule printed under the panel. A band's value is the mean fraction of light
// that gets through across the band (straight up, airmass 1.0).
export const BLOCKED_BELOW = 0.20; // mean < 20% -> "blocked"
export const OPEN_FROM = 0.80;     // mean >= 80% -> open; in between -> "partly"
export const RULE_TEXT = 'Blocked = under 20% of the band’s light gets through, on average across the band. Partly = 20–80%. Open = 80% or more. Worked out looking straight up (airmass 1.0).';

// Which real curve each kind of place uses. Only Mauna Kea has its own curve; every other
// place borrows the nearest real curve by height and water vapour, used as is (not rescaled,
// because the water, CO2 and ozone parts of the curve cannot be separated to rescale them).
export const CURVE_FOR_HEIGHT = [
  { minM: 3500, key: 'mk_16_10' },   // high summits: Mauna Kea, 1.6 mm water vapour
  { minM: 2300, key: 'cp_23_10' },   // ~2,300–3,500 m: Cerro Pachón, 2.3 mm
  { minM: 1000, key: 'cp_43_10' },   // ~1,000–2,300 m: Cerro Pachón, 4.3 mm
  { minM: -Infinity, key: 'cp_100_10' }, // low and humid: the wettest curve we have, 10 mm
];

// Rows besides the chosen place (lead's list). ids match places.js where the place exists.
export const COMPARE_SITES = [
  { id: 'maunakea', name: 'Mauna Kea', elev: 4205, lat: 19.8207, lon: -155.4681 },
  { id: 'paranal', name: 'Paranal', elev: 2635, lat: -24.6272, lon: -70.4042 },
  { id: 'kittpeak', name: 'Kitt Peak', elev: 2096, lat: 31.9583, lon: -111.5967 },
  { id: 'colombo', name: 'Colombo', elev: 5, lat: 6.927, lon: 79.861 },
];

const fmtInt = (n) => Math.round(n).toLocaleString('en-GB');

// Pick the curve for a place and say honestly how it was chosen.
// Returns { key, curve, approximate, how } or null if the data has no curve at all.
export function curveForPlace(place, data) {
  if (!data?.curves) return null;
  const heightKnown = Number.isFinite(place?.elev) && !(place.id === 'coords' || place.id === 'me');
  const h = heightKnown ? place.elev : 0;
  const key = CURVE_FOR_HEIGHT.find(r => h >= r.minM).key;
  const curve = data.curves[key]; if (!curve) return null;
  const own = place?.id === 'maunakea' && key === 'mk_16_10';
  const src = `${curve.site} curve (${fmtInt(curve.siteAltM)} m, ${curve.pwvMm} mm water vapour)`;
  let how;
  if (own) how = `Gemini’s own Mauna Kea curve, ${curve.pwvMm} mm water vapour`;
  else if (key === 'cp_100_10') how = `approximate, borrowed from ${src}: the wettest real curve we have. Air near sea level in the tropics often holds 30–50 mm of water vapour, so the real loss there is larger.`;
  else how = `approximate, borrowed from ${src}: the nearest real curve by height and water vapour, used as is (not rescaled)`;
  if (!heightKnown) how = `height not known, treated as sea level; ${how}`;
  return { key, curve, approximate: !own, how };
}

// Transmission at one wavelength (µm): linear between the 0.01 µm bin centres.
// Returns null outside the curve's range (the page says so instead of guessing).
export function transAt(data, curve, um) {
  const t = curve?.t; if (!t || !Number.isFinite(um)) return null;
  const x = (um - data.startUm) / data.stepUm;
  if (x < -1e-9 || x > t.length - 1 + 1e-9) return null;
  const i = Math.min(t.length - 2, Math.max(0, Math.floor(x))), f = Math.min(1, Math.max(0, x - i));
  const a = t[i], b = t[i + 1];
  if (a == null || b == null) return a ?? b ?? null;
  return a + (b - a) * f;
}

// Wavelength range the curve covers (µm).
export const coverage = (data, curve) => [data.startUm, data.startUm + (curve.t.length - 1) * data.stepUm];

// Mean transmission across [min, max] µm, over the part the curve covers. Sampled every
// 0.005 µm (half a bin). Returns { mean, from, to, partial } or null when nothing overlaps.
export function bandMean(data, curve, min, max) {
  const [c0, c1] = coverage(data, curve);
  const lo = Math.max(min, c0), hi = Math.min(max, c1);
  if (!(hi > lo)) return null;
  const n = Math.max(2, Math.ceil((hi - lo) / 0.005) + 1);
  let s = 0, k = 0;
  for (let j = 0; j < n; j++) { const v = transAt(data, curve, lo + (hi - lo) * j / (n - 1)); if (v != null) { s += v; k++; } }
  if (!k) return null;
  return { mean: s / k, from: lo, to: hi, partial: lo > min + 1e-9 || hi < max - 1e-9 };
}

// The rule: 'blocked' | 'partly' | 'open' (null when there is no value).
export function verdict(mean) {
  if (!Number.isFinite(mean)) return null;
  return mean < BLOCKED_BELOW ? 'blocked' : mean < OPEN_FROM ? 'partly' : 'open';
}

// Airmass for an apparent altitude (degrees): Kasten & Young (1989), good to the horizon.
// Returns null below the horizon.
export function airmass(altDeg) {
  if (!Number.isFinite(altDeg) || altDeg <= 0) return null;
  const z = 90 - altDeg;
  return 1 / (Math.cos(z * Math.PI / 180) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
}

// "Up · 54° high · airmass 1.24" / "Below the horizon".
export function targetLine(altDeg) {
  if (!Number.isFinite(altDeg)) return null;
  if (altDeg <= 0) return 'Below the horizon';
  return `Up · ${Math.round(altDeg)}° high · airmass ${airmass(altDeg).toFixed(2)}`;
}

// Ruler segments: consecutive 0.01 µm bins merged when their blocked share (1 − T, in 5%
// steps) is the same. Returns [{ from, to, block }] in µm over [RULER.min, RULER.max]; the
// part with no curve comes back as { from, to, block: null }.
export function rulerSegments(data, curve, lo = RULER.min, hi = RULER.max) {
  const out = [], [c0, c1] = coverage(data, curve), half = data.stepUm / 2;
  if (lo < c0) out.push({ from: lo, to: Math.min(c0, hi), block: null });
  for (let i = 0; i < curve.t.length; i++) {
    const w = data.startUm + i * data.stepUm, a = Math.max(lo, c0, w - half), b = Math.min(hi, c1, w + half);
    if (!(b > a) || curve.t[i] == null) continue;
    const block = Math.round((1 - curve.t[i]) * 20) / 20, last = out[out.length - 1];
    if (last && last.block === block && Math.abs(last.to - a) < 1e-9) last.to = b;
    else out.push({ from: a, to: b, block });
  }
  if (hi > c1) out.push({ from: Math.max(lo, c1), to: hi, block: null });
  return out;
}
