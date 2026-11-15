// "Can you actually see it?" from the catalogue V magnitude, kept apart from "is it above the horizon".
// One rule for the viewer's "Where to look" box, the planetarium answer card and any searched object
// (Master, Sun 15 Nov: "Can I see it tonight? Yes" for WISE 0855 misled beginners).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

export const EYE_LIMITS = [
  { max: 6, level: 'eye', text: 'naked eye, from a dark site' },
  { max: 9, level: 'binoculars', text: 'binoculars' },
  { max: 13, level: 'telescope', text: 'a small telescope' },
];
const TOO_FAINT = { level: 'faint', text: 'too faint for home telescopes: only infrared telescopes like SPHEREx see it' };

export function levelFor(v) {
  if (!Number.isFinite(v)) return TOO_FAINT;
  return EYE_LIMITS.find(l => v <= l.max) || TOO_FAINT;
}
const vTxt = (v) => (Math.round(v * 10) / 10).toFixed(1);

// vis: { v, source } or { vMin, vMax, source } (a variable star: brightest .. faintest), or null/undefined (no V known).
// Returns { level, simple, expert }: simple = the one plain line; expert = the V value and where it comes from.
export function seeItWith(vis) {
  if (vis && Number.isFinite(vis.vMin) && Number.isFinite(vis.vMax)) {
    const a = levelFor(vis.vMin), b = levelFor(vis.vMax);
    const how = a.level === b.level ? a.text : `${a.text} at its brightest, ${b.level === 'faint' ? 'too faint for home telescopes' : b.text} at its faintest`;
    return { level: a.level, simple: `To see it: ${how} (it varies, V ${vTxt(vis.vMin)}–${vTxt(vis.vMax)}).`, expert: `V range from ${vis.source || 'the catalogue'}` }; // the range itself is already in the plain line
  }
  const v = vis?.v, l = levelFor(v);
  return { level: l.level, simple: `To see it: ${l.text}.`, expert: Number.isFinite(v) ? `V ${vTxt(v)} (${vis.source || 'catalogue'})` : 'No visible-light (V) magnitude in the catalogue' };
}
