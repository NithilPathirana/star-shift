// NASA's five test targets. Positions and proper motions from SIMBAD (Harvard mirror,
// fetched 14 Nov 2026; ICRS, epoch J2000) so they load even if SIMBAD is down.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

export const PRESETS = [
  { key: 'barnard', label: "Barnard's Star", aliases: ["barnard's star", 'barnards star', 'barnard star', 'gj 699', 'v2500 oph'],
    target: { name: "Barnard's Star", ra: 269.4520769586187, dec: 4.693364966576667, pmra: -801.551, pmdec: 10362.394, plx: 546.9759, rv: -110.11, epoch: 2000, source: 'SIMBAD' },
    note: 'Fastest-moving star in our sky' },
  { key: 'eps-indi-b', label: 'Epsilon Indi B', aliases: ['epsilon indi b', 'eps ind b', 'eps indi b', 'ε indi b'],
    target: { name: 'Epsilon Indi B', ra: 331.04414658852124, dec: -56.782844195116105, pmra: 3981.977, pmdec: -2466.832, plx: 270.658, epoch: 2000, source: 'SIMBAD' },
    note: 'A pair of brown dwarfs' },
  { key: 'wise-0855', label: 'WISE 0855', aliases: ['wise 0855', 'wise 0855-0714', 'wise j085510.83-071442.5', 'wisea j085510.74-071442.5'],
    target: { name: 'WISE 0855−0714', ra: 133.81890825, dec: -7.247048, pmra: -8123.7, pmdec: 673.2, plx: 439, epoch: 2000, source: 'SIMBAD' },
    note: 'Coldest known brown dwarf', bandHint: 'Only visible at 3.8–5 µm (bands 5–6)' },
  { key: 'rw-aur', label: 'RW Aurigae', aliases: ['rw aurigae', 'rw aur'],
    target: { name: 'RW Aurigae', ra: 76.95652603458333, dec: 30.401438173888888, pmra: 7.23, pmdec: -20.33, plx: 15.42, rv: 15.0, epoch: 2000, source: 'SIMBAD' },
    note: 'Young star that changes brightness' },
  { key: 'r-dra', label: 'R Draconis', aliases: ['r draconis', 'r dra'],
    target: { name: 'R Draconis', ra: 248.16761083295, dec: 66.75497941722, pmra: -20.643, pmdec: 6.149, plx: 1.2509, rv: -132.8, epoch: 2000, source: 'SIMBAD' },
    note: 'Pulsating red giant (variable)' },
];

export function findPreset(name) {
  const n = String(name).trim().toLowerCase().replace(/\s+/g, ' ').replace(/[’`]/g, "'");
  return PRESETS.find(p => p.key === n || p.label.toLowerCase() === n || p.aliases.includes(n)) || null;
}
