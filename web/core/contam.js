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

// ---- "Hide images where these touch the star" (DESIGN.md 23) ----
// Only real contamination close to the star counts. SOURCE and FULLSAMPLE are information.
// A bright star fills its own core pixels (OVERFLOW, BLOOM): that is a "saturated core",
// shown as information and never hidden.
export const CORE_PX = 2; // grid pixels (~12″) around the predicted position
export const HIDE_KINDS = [
  { id: 'cosmic', name: 'Signal jump', bits: ['TRANSIENT', 'SNOWBALL', 'HALO'] },
  { id: 'persist', name: 'Afterglow (persistence)', bits: ['PERSIST'] },
  { id: 'scatter', name: 'Scattered light', bits: ['GHOST', 'GHOST_FPA', 'GHOST_EXT'] },
  { id: 'streak', name: 'Streak', bits: ['STREAK'] },
  { id: 'airglow', name: 'Airglow', frame: true },
];
export const HIDE_IDS = HIDE_KINDS.map(k => k.id);

// OR of the bits whose header name is in `names`.
export function bitsNamed(flagNames, names) {
  let m = 0;
  for (const [bit, d] of Object.entries(flagNames || {})) if (names.includes(d.name)) m |= Number(bit);
  return m;
}

// Classify one image for the filter. flags: FLAGS words on the n×n display grid;
// (cx, cy): the star's predicted grid position; glow: airglowOf(...).
// Returns { hits: { id: nearest distance in px }, saturated, airglow, reasons: [text], hidden-by ids in `hits` }.
export function classifyFrame({ flags, flagNames, n, cx, cy, glow }, r = CORE_PX) {
  const hits = {}, masks = HIDE_KINDS.filter(k => k.bits).map(k => [k.id, bitsNamed(flagNames, k.bits)]);
  // Saturated core: OVERFLOW or BLOOM on the star's own pixels. On those same pixels the
  // pipeline also sets TRANSIENT (the sample-up-the-ramp jump as the pixel fills): measured on
  // Barnard's Star, 118 of 120 images carry OVERFLOW+BLOOM+TRANSIENT on the core. So TRANSIENT
  // on an OVERFLOW/BLOOM pixel is the star itself and does not count; TRANSIENT elsewhere does.
  const SAT = bitsNamed(flagNames, ['OVERFLOW', 'BLOOM']), TRANS = bitsNamed(flagNames, ['TRANSIENT']);
  let saturated = false;
  if (flags && n) {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(n - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(n - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy); if (d > r) continue;
      let w = flags[y * n + x]; if (!w) continue;
      if (SAT && (w & SAT)) { saturated = true; w &= ~TRANS; }
      for (const [id, m] of masks) if (m && (w & m) && !(hits[id] <= d)) hits[id] = d;
    }
  }
  // Airglow: aurora / shuttle glow count for the whole image. Helium airglow is one emission line
  // (1.083 µm), so it only touches the star when the star sits at that wavelength (nearHe).
  const g = glow || {}, why = [];
  if ('he' in g) {
    if (g.he && g.nearHe) why.push('helium line at the star\'s wavelength');
    if (g.aurora) why.push('aurora');
    if (g.shuttle) why.push('spacecraft glow');
  } else if (g.flagged) why.push(...(g.reasons || []));
  const airglow = why.length > 0;
  if (airglow) hits.airglow = 0;
  const airText = `Airglow${why.length ? ` (${why.join(', ')})` : ''}`;
  const reasons = HIDE_KINDS.filter(k => hits[k.id] != null).map(k => k.frame ? airText : `${k.name} ${hits[k.id].toFixed(1)} px from the star`);
  return { hits, saturated, airglow, airText, reasons };
}

// Why a classified image is hidden, given the kinds being hidden (null = not hidden).
export function hideReason(cls, hide) {
  if (!cls) return null;
  const ids = HIDE_KINDS.filter(k => hide.has(k.id) && cls.hits?.[k.id] != null);
  if (!ids.length) return null;
  return ids.map(k => k.frame ? cls.airText : `${k.name} ${cls.hits[k.id].toFixed(1)} px from the star`).join(' · ');
}

// Does a frame summary show this kind? Summary is a classifyFrame result ({ hits }) or the
// older { counts, glow } shape.
export function frameHas(fr, id) {
  if (fr?.hits) return fr.hits[id] != null;
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
