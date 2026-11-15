// NASA's five test targets. Positions and proper motions from SIMBAD (Harvard mirror,
// fetched 14 Nov 2026; ICRS, epoch J2000) so they load even if SIMBAD is down.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

// holdBand: the detector pair 'Hold one band' plays by default (ui.js, viewerbits.js), the one
// whose images most often show the star's centre unblanked (counted on the 120 viewer images, 15 Nov);
// WISE 0855 uses 5–6, the only detectors where it shows. holdNote finishes "Showing 3.8–5.0 µm: …".
export const PRESETS = [
  { key: 'barnard', label: "Barnard's Star", aliases: ["barnard's star", 'barnards star', 'barnard star', 'gj 699', 'v2500 oph'],
    target: { name: "Barnard's Star", ra: 269.4520769586187, dec: 4.693364966576667, pmra: -801.551, pmdec: 10362.394, plx: 546.9759, rv: -110.11, epoch: 2000, source: 'SIMBAD' },
    note: 'Fastest-moving star in our sky', vis: { v: 9.511, source: 'SIMBAD' },
    holdBand: [5, 6], holdNote: "its centre is blanked least often at these wavelengths" }, // 4 of 41 images blanked; 78 of 79 at shorter wavelengths
  { key: 'eps-indi-b', label: 'Epsilon Indi B', aliases: ['epsilon indi b', 'eps ind b', 'eps indi b', 'ε indi b'],
    target: { name: 'Epsilon Indi B', ra: 331.04414658852124, dec: -56.782844195116105, pmra: 3981.977, pmdec: -2466.832, plx: 270.658, epoch: 2000, source: 'SIMBAD' },
    note: 'A pair of brown dwarfs 0.7″ apart: SPHEREx’s 6.15″ pixels see one dot, so we track their shared light centre. They orbit Epsilon Indi A, 6.7′ away.', vis: { v: 24.12, source: 'SIMBAD' },
    holdBand: [1, 2], holdNote: 'its centre is blanked least often at these wavelengths' }, // 1 of 46 blanked
  { key: 'wise-0855', label: 'WISE 0855', aliases: ['wise 0855', 'wise 0855-0714', 'wise j085510.83-071442.5', 'wisea j085510.74-071442.5'],
    target: { name: 'WISE 0855−0714', ra: 133.81890825, dec: -7.247048, pmra: -8123.7, pmdec: 673.2, plx: 439, epoch: 2000, source: 'SIMBAD' },
    note: 'Coldest known brown dwarf', vis: null /* no V in SIMBAD */, bandHint: 'Only visible at 3.8–5 µm (bands 5–6)',
    motionDetectors: [5, 6], holdBand: [5, 6], holdNote: 'WISE 0855 is invisible at shorter wavelengths' }, // its motion is measured on these detectors only (viewer + Proof; data.js motionDetectors)
  { key: 'rw-aur', label: 'RW Aurigae', aliases: ['rw aurigae', 'rw aur'],
    target: { name: 'RW Aurigae', ra: 76.95652603458333, dec: 30.401438173888888, pmra: 7.23, pmdec: -20.33, plx: 15.42, rv: 15.0, epoch: 2000, source: 'SIMBAD' },
    note: 'Young star that changes brightness', vis: { vMin: 9.2, vMax: 12.5, source: 'GCVS' },
    holdBand: [5, 6], holdNote: 'its centre is blanked least often at these wavelengths' }, // 1 of 39 blanked
  { key: 'r-dra', label: 'R Draconis', aliases: ['r draconis', 'r dra'],
    target: { name: 'R Draconis', ra: 248.16761083295, dec: 66.75497941722, pmra: -20.643, pmdec: 6.149, plx: 1.2509, rv: -132.8, epoch: 2000, source: 'SIMBAD' },
    note: 'Pulsating red giant (variable)', vis: { vMin: 6.7, vMax: 13.2, source: 'GCVS' },
    holdBand: [5, 6], holdNote: 'its centre is blanked in every band; this one has the most images' },
];

const norm = (name) => String(name).trim().toLowerCase().replace(/\s+/g, ' ').replace(/[’`]/g, "'");
export function findPreset(name) {
  const n = norm(name);
  return PRESETS.find(p => p.key === n || p.label.toLowerCase() === n || p.aliases.includes(n)) || null;
}

// Saved targets beyond NASA's five (Sun 15 Nov, IRSA outage): built-in SIMBAD values (Harvard mirror,
// fetched 15 Nov 2026; ICRS, epoch J2000) so the name never needs SIMBAD, and their viewer images are
// in web/prebaked/ (tools/export_prebaked.mjs --add=…; baked: true once saved, so they show as saved chips).
// Not presets: no ring, Proof or quick pick.
export const SAVED = [
  { key: 'teegarden', baked: true, label: "Teegarden's Star", aliases: ["teegarden's star", 'teegardens star', 'teegarden star', 'teegarden', 'so 0253+1652', 'gaia 0253+1652'],
    target: { name: "Teegarden's Star", ra: 43.253715805170415, dec: 16.881286719482496, pmra: 3429.083, pmdec: -3805.541, plx: 260.9884, rv: 63, epoch: 2000, otype: 'LM*', vmag: 15.14, source: 'SIMBAD' } },
  { key: 'proxima', baked: true, label: 'Proxima Centauri', aliases: ['proxima centauri', 'proxima', 'proxima cen', 'alf cen c', 'gj 551', 'v645 cen'],
    target: { name: 'Proxima Centauri', ra: 217.42894222160578, dec: -62.67949018907555, pmra: -3781.741, pmdec: 769.465, plx: 768.0665, rv: -20.578199, epoch: 2000, otype: 'PM*', vmag: 11.13, source: 'SIMBAD' } },
  { key: 'vega', baked: true, label: 'Vega', aliases: ['vega', 'alf lyr', 'alpha lyrae', 'α lyr'],
    target: { name: 'Vega', ra: 279.234734787025, dec: 38.783688956244, pmra: 200.94, pmdec: 286.23, plx: 130.23, rv: -13.5, epoch: 2000, otype: 'dS*', vmag: 0.03, source: 'SIMBAD' } },
  { key: 'sirius', baked: true, label: 'Sirius', aliases: ['sirius', 'alf cma', 'alpha canis majoris', 'α cma'],
    target: { name: 'Sirius', ra: 101.28715533333335, dec: -16.71611586111111, pmra: -546.01, pmdec: -1223.07, plx: 379.21, rv: -5.5, epoch: 2000, otype: 'SB*', vmag: -1.46, source: 'SIMBAD' } },
  { key: 'polaris', baked: true, label: 'Polaris', aliases: ['polaris', 'alf umi', 'alpha ursae minoris', 'north star', 'α umi'],
    target: { name: 'Polaris', ra: 37.954560670189856, dec: 89.26410896994187, pmra: 44.48, pmdec: -11.85, plx: 7.54, rv: -16.42, epoch: 2000, otype: 'cC*', vmag: 2.02, source: 'SIMBAD' } },
];
export function findSaved(name) {
  const n = norm(name);
  return SAVED.find(p => p.key === n || p.label.toLowerCase() === n || p.aliases.includes(n)) || null;
}
