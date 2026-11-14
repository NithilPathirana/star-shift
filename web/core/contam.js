// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Contamination kinds for the flag overlay (team feature B, DESIGN.md section 23).
// Pixel kinds come from the bits each SPHEREx FLAGS header names for itself (MSKN/MSKM
// cards, read by flagDefinitions in irsa.js); nothing here hard-codes a bit value.
// Airglow is not a pixel bit: it is a whole-image property, read from the IMAGE header
// (HE_AIRGLOW_CONT, AURORA_CONT, SHUTTLE_GLOW_CONT) plus the image's wavelength sitting
// on the 1.083 µm helium line that the Earth's upper atmosphere glows in.

export const HE_LINE_UM = 1.0833;

// Table order = drawing priority (DESIGN.md 23: a pixel shows the first kind it has).
export const KINDS = [
  { id: 'cosmic', name: 'Cosmic ray hit', meaning: 'A particle hit the detector during the exposure', bits: ['TRANSIENT', 'SNOWBALL', 'HALO'] },
  { id: 'overflow', name: 'Pixel overflow', meaning: 'Too bright: the pixel filled up before the exposure ended', bits: ['OVERFLOW'] },
  { id: 'scatter', name: 'Scattered light', meaning: 'Stray light from a bright source in or outside the view', bits: ['GHOST', 'GHOST_FPA', 'GHOST_EXT'] },
  { id: 'airglow', name: 'Airglow', meaning: 'Glow from Earth\'s upper air at 1.083 µm (whole image)', frame: true },
  { id: 'other', name: 'Other flag', meaning: 'Any other warning in the archive\'s quality mask', bits: null },
];
export const PIXEL_KINDS = KINDS.filter(k => !k.frame).map(k => k.id);
// Bits that describe a pixel but are not a problem with it.
export const INFO_BITS = ['SOURCE', 'FULLSAMPLE'];

const truthy = v => v === true || /^(t|true|1|yes)$/i.test(String(v ?? '').trim());

// { cosmic, overflow, scatter, other } bit masks for one image's flag definitions.
export function kindMasks(flagNames) {
  const m = { cosmic: 0, overflow: 0, scatter: 0, other: 0 };
  for (const [bit, d] of Object.entries(flagNames || {})) {
    const b = Number(bit);
    const k = KINDS.find(k => k.bits?.includes(d.name));
    if (k) m[k.id] |= b;
    else if (!INFO_BITS.includes(d.name)) m.other |= b;
  }
  return m;
}

// Kinds present in one pixel's flag word, in table order.
export function pixelKinds(word, masks) {
  const out = [];
  for (const id of PIXEL_KINDS) if (masks[id] && (word & masks[id])) out.push(id);
  return out;
}

// Flag names set in one pixel's word (for the tooltip).
export function flagNamesOf(word, flagNames) {
  const out = [];
  for (const [bit, d] of Object.entries(flagNames || {})) if (word & Number(bit) && !INFO_BITS.includes(d.name)) out.push(d.name);
  return out;
}

// Per-image counts on the display grid. data: pixel values (null/NaN = no data).
// region (optional) { n, cx, cy, r }: count only pixels within r grid pixels of (cx, cy).
export function countKinds(flags, masks, data, region) {
  const c = { cosmic: 0, overflow: 0, scatter: 0, other: 0, nodata: 0, flagged: 0 };
  const N = flags ? flags.length : (data ? data.length : 0);
  for (let i = 0; i < N; i++) {
    if (region && Math.hypot((i % region.n) - region.cx, Math.floor(i / region.n) - region.cy) > region.r) continue;
    const v = data ? data[i] : 0, empty = v == null || Number.isNaN(v);
    const w = flags ? flags[i] : 0;
    let any = empty;
    if (empty) c.nodata++;
    for (const id of PIXEL_KINDS) if (masks[id] && (w & masks[id])) { c[id]++; any = true; }
    if (any) c.flagged++;
  }
  return c;
}

// Whole-image airglow verdict. header: IMAGE header; um/bwUm: wavelength and channel width
// at the target (from wave.js). Near the He line = within one channel width (min 0.02 µm).
export function airglowOf(header, um, bwUm) {
  const h = header || {};
  const he = truthy(h.HE_AIRGLOW_CONT), aurora = truthy(h.AURORA_CONT), shuttle = truthy(h.SHUTTLE_GLOW_CONT);
  const det = Number(h.DETECTOR);
  const tol = Math.max(0.02, Number.isFinite(bwUm) ? bwUm : 0);
  const nearHe = (det === 1 || det === 2 || !det) && Number.isFinite(um) && Math.abs(um - HE_LINE_UM) <= tol;
  const ampl = Number.isFinite(h.HE_AG_AMPL) ? h.HE_AG_AMPL : null;
  const reasons = [];
  if (he) reasons.push('HE_AIRGLOW_CONT');
  if (aurora) reasons.push('AURORA_CONT');
  if (shuttle) reasons.push('SHUTTLE_GLOW_CONT');
  if (nearHe) reasons.push('near 1.083 µm');
  return { he, aurora, shuttle, nearHe, ampl, flagged: reasons.length > 0, reasons, known: 'HE_AIRGLOW_CONT' in h };
}

// Does a frame summary { counts, glow } show this kind?
export function frameHas(fr, id) {
  if (id === 'airglow') return !!fr?.glow?.flagged;
  return (fr?.counts?.[id] || 0) > 0;
}

// Frames left after hiding every frame that shows any of the kinds in `hide`.
export function visibleFrames(frames, hide, summary = f => f) {
  const ids = [...(hide || [])];
  if (!ids.length) return frames.slice();
  return frames.filter(f => !ids.some(id => frameHas(summary(f), id)));
}

// Low/high display limits for a layer (2nd and 98th percentile of finite values).
export function layerRange(arr) {
  const v = [];
  for (const x of arr || []) if (x != null && Number.isFinite(x)) v.push(x);
  if (!v.length) return null;
  v.sort((a, b) => a - b);
  const q = p => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  return { lo: q(0.02), hi: q(0.98), median: q(0.5) };
}
