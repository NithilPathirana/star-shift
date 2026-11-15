// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// The quick-pick chips are NASA's five challenge targets: one plain line each (chip title +
// aria-description), and the Viewer's "Surprise me" (search menu), which loads one of Spot's
// checked patches (spot/logic.js SURPRISE: each has two or more SPHEREx seasons).
import { findPreset } from './presets.js';
import { SURPRISE, pickSurprise } from './spot/logic.js';

export const PICK_LABEL = "NASA's challenge targets";
export const PICK_TIPS = {
  'barnard': 'fastest-moving star in our sky',
  'eps-indi-b': 'brown-dwarf pair orbiting a nearby star',
  'wise-0855': 'coldest known brown dwarf, seen only in long infrared',
  'rw-aur': 'young star that changes brightness',
  'r-dra': 'giant star that brightens and fades',
};
// key ('barnard') or chip text ("Barnard's Star", 'WISE 0855−0714')
export function pickTip(keyOrLabel) {
  const k = PICK_TIPS[keyOrLabel] ? keyOrLabel : findPreset(String(keyOrLabel).replace('−', '-'))?.key;
  return PICK_TIPS[k] || '';
}
// title + aria-description on every chip in root that has a tip
export function tipPicks(root = document) {
  for (const b of root.querySelectorAll('.pick')) {
    const t = pickTip(b.dataset.key || b.textContent.trim());
    if (t) { b.title = t; b.setAttribute('aria-description', t); }
  }
}

// The search placeholder, shortened only when the field is too narrow to show it whole.
const PLACEHOLDERS = ['Any star name or coordinates, e.g. Vega or 269.45 +4.69', 'Any star or coordinates, e.g. Vega or 269.45 +4.69',
  'Any star, e.g. Vega or 269.45 +4.69', 'Any star or coordinates'];
export function fitPlaceholder(input) {
  if (!input) return;
  const ctx = document.createElement('canvas').getContext('2d');
  const fit = () => {
    const w = input.clientWidth; if (!w) return;
    const cs = getComputedStyle(input); ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    input.placeholder = PLACEHOLDERS.find(p => ctx.measureText(p).width <= w - 2) || PLACEHOLDERS[PLACEHOLDERS.length - 1];
  };
  new ResizeObserver(fit).observe(input); document.fonts?.ready.then(fit); fit();
}

let lastKey = null;
// A different surprise patch each time: { name, ra, dec, pmra, pmdec, plx, epoch, source } (SIMBAD, J2000).
export function surpriseTarget(rand = Math.random) {
  const f = pickSurprise(lastKey, rand); lastKey = f.key;
  return f.target;
}
export const SURPRISE_COUNT = SURPRISE.length;
