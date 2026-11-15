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
    holdBand: [5, 6], holdNote: "its centre is blanked least often here (4 of 41 images; 78 of 79 at shorter wavelengths)" },
  { key: 'eps-indi-b', label: 'Epsilon Indi B', aliases: ['epsilon indi b', 'eps ind b', 'eps indi b', 'ε indi b'],
    target: { name: 'Epsilon Indi B', ra: 331.04414658852124, dec: -56.782844195116105, pmra: 3981.977, pmdec: -2466.832, plx: 270.658, epoch: 2000, source: 'SIMBAD' },
    note: 'A pair of brown dwarfs', vis: { v: 24.12, source: 'SIMBAD' },
    holdBand: [1, 2], holdNote: 'its centre is blanked least often here (1 of 46 images)' },
  { key: 'wise-0855', label: 'WISE 0855', aliases: ['wise 0855', 'wise 0855-0714', 'wise j085510.83-071442.5', 'wisea j085510.74-071442.5'],
    target: { name: 'WISE 0855−0714', ra: 133.81890825, dec: -7.247048, pmra: -8123.7, pmdec: 673.2, plx: 439, epoch: 2000, source: 'SIMBAD' },
    note: 'Coldest known brown dwarf', vis: null /* no V in SIMBAD */, bandHint: 'Only visible at 3.8–5 µm (bands 5–6)',
    motionDetectors: [5, 6], holdBand: [5, 6], holdNote: 'WISE 0855 is invisible at shorter wavelengths' }, // its motion is measured on these detectors only (viewer + Proof; data.js motionDetectors)
  { key: 'rw-aur', label: 'RW Aurigae', aliases: ['rw aurigae', 'rw aur'],
    target: { name: 'RW Aurigae', ra: 76.95652603458333, dec: 30.401438173888888, pmra: 7.23, pmdec: -20.33, plx: 15.42, rv: 15.0, epoch: 2000, source: 'SIMBAD' },
    note: 'Young star that changes brightness', vis: { vMin: 9.2, vMax: 12.5, source: 'GCVS' },
    holdBand: [5, 6], holdNote: 'its centre is blanked least often here (1 of 39 images)' },
  { key: 'r-dra', label: 'R Draconis', aliases: ['r draconis', 'r dra'],
    target: { name: 'R Draconis', ra: 248.16761083295, dec: 66.75497941722, pmra: -20.643, pmdec: 6.149, plx: 1.2509, rv: -132.8, epoch: 2000, source: 'SIMBAD' },
    note: 'Pulsating red giant (variable)', vis: { vMin: 6.7, vMax: 13.2, source: 'GCVS' },
    holdBand: [5, 6], holdNote: 'its centre is blanked in every band, so this one simply has the most images' },
];

export function findPreset(name) {
  const n = String(name).trim().toLowerCase().replace(/\s+/g, ' ').replace(/[’`]/g, "'");
  return PRESETS.find(p => p.key === n || p.label.toLowerCase() === n || p.aliases.includes(n)) || null;
}
