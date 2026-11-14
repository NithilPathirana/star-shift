// Custom infrared colour bands: the user picks a wavelength range, a colour and a name.
// Each band is drawn on the sky map as the SPHEREx channels inside that range, tinted
// with its colour and added together. Saved in this browser only (localStorage).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { CHANNEL_UM } from './skymap.js';

// Editor domain 0.74–5.01 µm: covers SPHEREx's 6 detectors (0.7455–5.0096 µm in IRSA's
// tables; 0.744–5.002 µm in the Explanatory Supplement v2.0).
export const RANGE = { min: 0.74, max: 5.01 };
export const DETECTORS = [
  { d: 1, min: 0.7455, max: 1.1167, R: 39 }, { d: 2, min: 1.1033, max: 1.6499, R: 41 }, { d: 3, min: 1.6301, max: 2.4346, R: 41 },
  { d: 4, min: 2.4027, max: 3.8473, R: 35 }, { d: 5, min: 3.8113, max: 4.4300, R: 112 }, { d: 6, min: 4.4115, max: 5.0096, R: 128 },
];
const KEY = 'spherex-viewer.bands.v2';
export const MAX_BANDS = 8;

// Team defaults (decided Sat 14 Nov 2026): short-to-long wavelength runs blue -> red, and
// each name says what that range is good for. Users can edit or replace them.
export const DEFAULT_BANDS = [
  { id: 'd-starlight', name: 'Starlight', min: 0.74, max: 1.11, color: '#5b8cff', on: true,
    tip: 'Shortest SPHEREx light, closest to what our eyes see: ordinary stars shine brightest here.' },
  { id: 'd-coolstars', name: 'Cool Stars', min: 1.11, max: 1.64, color: '#3fc1c9', on: true,
    tip: "Near-infrared where cool red dwarfs (like Barnard's Star) give off most of their light." },
  { id: 'd-dust', name: 'Through the Dust', min: 1.64, max: 2.42, color: '#7bd389', on: true,
    tip: 'Longer light slips through dusty clouds, so hidden and young stars show up here.' },
  { id: 'd-waterice', name: 'Water Ice', min: 2.42, max: 3.82, color: '#f2c14e', on: true,
    tip: 'Contains the 3.05 µm water-ice feature: frozen water on dust grains absorbs light here.' },
  { id: 'd-co2ice', name: 'CO₂ Ice', min: 3.82, max: 4.42, color: '#f28c38', on: true,
    tip: 'Contains the 4.27 µm carbon-dioxide-ice feature seen in cold molecular clouds.' },
  { id: 'd-browndwarfs', name: 'Brown Dwarfs', min: 4.42, max: 5.01, color: '#e5484d', on: true,
    tip: 'Longest SPHEREx light: very cold objects such as the brown dwarf WISE 0855 show up here.' },
];

// Labels for a band when it names the CURRENT image (stage chip, timeline tooltip, details panel,
// loader caption). A band is a wavelength RANGE, never a finding: "CO₂-ice band · 3.82–4.42 µm"
// with the tooltip "The wavelength range where CO₂ ice absorbs light. Not a detection."
// The band editor keeps the short names. Matches a default only while its name is unchanged.
const DEFAULT_LABELS = {
  'd-starlight': ['Starlight band', 'The wavelength range closest to what our eyes see, where ordinary stars shine brightest.'],
  'd-coolstars': ['Cool-star band', 'The wavelength range where cool red dwarfs give off most of their light.'],
  'd-dust': ['Through-the-dust band', 'The wavelength range that slips through dusty clouds, so hidden stars can show.'],
  'd-waterice': ['Water-ice band', 'The wavelength range where water ice absorbs light.'],
  'd-co2ice': ['CO₂-ice band', 'The wavelength range where CO₂ ice absorbs light.'],
  'd-browndwarfs': ['Brown-dwarf band', 'The wavelength range where very cold brown dwarfs are brightest.'],
};
const fmtUm = v => (Number.isFinite(+v) ? (+v).toFixed(2) : '?');
export function bandRangeText(b) { return `${fmtUm(b?.min)}–${fmtUm(b?.max)} µm`; }
// Short "<name> band" form (no numbers): for places that already print the wavelength.
export function bandName(b) {
  if (!b) return '';
  const def = DEFAULT_BANDS.find(d => d.id === b.id && d.name === b.name);
  if (def) return DEFAULT_LABELS[def.id][0];
  const n = String(b.name ?? '').trim() || 'Unnamed';
  return /\bband$/i.test(n) ? n : `${n} band`;
}
// { name, range, text, tip } for a band { id, name, min, max }.
export function bandLabel(b) {
  if (!b) return null;
  const name = bandName(b), range = bandRangeText(b);
  const def = DEFAULT_BANDS.find(d => d.id === b.id && d.name === b.name);
  const tip = def ? `${DEFAULT_LABELS[def.id][1]} Not a detection.`
    : `The ${range} range you named “${String(b.name ?? '').trim() || 'Unnamed'}”. A wavelength range, not a detection.`;
  return { name, range, text: `${name} · ${range}`, tip };
}

export class BandError extends Error {}

// Validate a user's band. Accepts numbers or strings; returns a clean band or throws BandError.
export function validateBand({ name, min, max, color }, existing = [], editingId = null) {
  const lo = Number(String(min).replace(',', '.')), hi = Number(String(max).replace(',', '.'));
  const n = String(name ?? '').trim();
  const fmt = (x) => x.toFixed(2);
  if (!n) throw new BandError('Give the band a name.');
  if (n.length > 40) throw new BandError('Keep the name under 40 characters.');
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new BandError('Type both wavelengths as numbers in micrometres (µm), e.g. 1.6 and 2.4.');
  const problems = [];
  if (lo > hi) problems.push(`the range runs backwards (${lo} is bigger than ${hi}); put the smaller number first`);
  for (const v of [lo, hi]) {
    if (v < RANGE.min) problems.push(`${v} µm is shorter than SPHEREx can see (its shortest is ${fmt(RANGE.min)} µm)`);
    if (v > RANGE.max) problems.push(`${v} µm is longer than SPHEREx can see (its longest is ${fmt(RANGE.max)} µm)`);
  }
  if (problems.length) throw new BandError(`That range won't work: ${problems.join('; and ')}. SPHEREx covers ${fmt(RANGE.min)}–${fmt(RANGE.max)} µm.`);
  if (lo === hi) throw new BandError('Make the range a little wider than a single value (e.g. 2.0 to 2.1 µm).');
  if (!/^#[0-9a-f]{6}$/i.test(String(color))) throw new BandError('Pick a colour.');
  if (!editingId && existing.length >= MAX_BANDS) throw new BandError(`You can have up to ${MAX_BANDS} bands. Delete or edit one first.`);
  return { name: n, min: lo, max: hi, color: String(color).toLowerCase() };
}

// SPHEREx channels whose centre falls in [min, max]; at least the nearest one.
export function channelsFor(min, max) {
  const inside = CHANNEL_UM.map((um, i) => [um, i]).filter(([um]) => um >= min && um <= max).map(([, i]) => i);
  if (inside.length) return inside;
  const mid = (min + max) / 2;
  let best = 0;
  CHANNEL_UM.forEach((um, i) => { if (Math.abs(um - mid) < Math.abs(CHANNEL_UM[best] - mid)) best = i; });
  return [best];
}

// Evenly pick at most `k` channels (keeps the map fast).
export function sampleChannels(chs, k) {
  if (chs.length <= k) return chs;
  return Array.from({ length: k }, (_, i) => chs[Math.round((i * (chs.length - 1)) / (k - 1 || 1))]);
}

// Map layers for the visible bands: a total budget of ~12 tinted layers.
export function layersFor(bands, budget = 12) {
  const on = bands.filter(b => b.on);
  if (!on.length) return [];
  const per = Math.max(1, Math.floor(budget / on.length));
  return on.map(b => ({ color: b.color.replace('#', ''), channels: sampleChannels(channelsFor(b.min, b.max), Math.min(4, per)) }));
}

export function detectorsFor(min, max) {
  return DETECTORS.filter(d => d.max >= min && d.min <= max).map(d => d.d);
}

export function loadBands(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return DEFAULT_BANDS.map(b => ({ ...b }));
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error('bad');
    return list.filter(b => b && typeof b.name === 'string' && /^#[0-9a-f]{6}$/i.test(b.color) && b.min >= RANGE.min && b.max <= RANGE.max && b.min < b.max).slice(0, MAX_BANDS);
  } catch {
    return DEFAULT_BANDS.map(b => ({ ...b }));
  }
}

export function saveBands(bands, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(bands)); return true; } catch { return false; }
}

export function resetBands(storage = globalThis.localStorage) {
  try { storage?.removeItem(KEY); } catch { /* private mode */ }
  return DEFAULT_BANDS.map(b => ({ ...b }));
}
