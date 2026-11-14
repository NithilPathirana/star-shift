// Builds web/app/data/stars.json: the bright stars for the 3D sky (Sky3D).
// Source: Hipparcos (ESA), new reduction (van Leeuwen 2007), via the ESA Gaia archive TAP.
// V magnitudes come from the original Hipparcos catalogue (same archive), joined on HIP.
// Positions are moved with their proper motion from J1991.25 to J2025.5 (the SPHEREx epoch).
// Run once:  node tools/make_stars.mjs   (needs internet; ~10 s)
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TAP = 'https://gea.esac.esa.int/tap-server/tap/sync';
const HP_LIMIT = 6.9; // gives about 13k stars
const EPOCH_FROM = 1991.25, EPOCH_TO = 2025.5;
export const CREDIT = 'Hipparcos (ESA), new reduction (van Leeuwen 2007), via the ESA Gaia archive';

// Proper names of the brightest stars (IAU names), by HIP number. Hand-written, no scraping.
export const NAMES = {
  32349: 'Sirius', 30438: 'Canopus', 69673: 'Arcturus', 71683: 'Rigil Kentaurus', 71681: 'Toliman', 91262: 'Vega',
  24608: 'Capella', 24436: 'Rigel', 37279: 'Procyon', 7588: 'Achernar', 27989: 'Betelgeuse', 68702: 'Hadar',
  97649: 'Altair', 60718: 'Acrux', 21421: 'Aldebaran', 80763: 'Antares', 65474: 'Spica', 37826: 'Pollux',
  113368: 'Fomalhaut', 102098: 'Deneb', 62434: 'Mimosa', 49669: 'Regulus', 33579: 'Adhara', 36850: 'Castor',
  61084: 'Gacrux', 85927: 'Shaula', 25336: 'Bellatrix', 25428: 'Elnath', 45238: 'Miaplacidus', 26311: 'Alnilam',
  109268: 'Alnair', 26727: 'Alnitak', 62956: 'Alioth', 54061: 'Dubhe', 15863: 'Mirfak', 34444: 'Wezen',
  86228: 'Sargas', 90185: 'Kaus Australis', 41037: 'Avior', 67301: 'Alkaid', 28360: 'Menkalinan', 82273: 'Atria',
  31681: 'Alhena', 100751: 'Peacock', 42913: 'Alsephina', 30324: 'Mirzam', 46390: 'Alphard', 11767: 'Polaris',
  9884: 'Hamal', 50583: 'Algieba', 3419: 'Diphda', 92855: 'Nunki', 68933: 'Menkent', 5447: 'Mirach',
  677: 'Alpheratz', 86032: 'Rasalhague', 72607: 'Kochab', 27366: 'Saiph', 57632: 'Denebola', 14576: 'Algol',
  112122: 'Tiaki', 61932: 'Muhlifain', 45556: 'Aspidiske', 44816: 'Suhail', 76267: 'Alphecca', 65378: 'Mizar',
  100453: 'Sadr', 3179: 'Schedar', 87833: 'Eltanin', 25930: 'Mintaka', 746: 'Caph', 78401: 'Dschubba',
  82396: 'Larawag', 53910: 'Merak', 2081: 'Ankaa', 86670: 'Girtab', 107315: 'Enif', 113881: 'Scheat',
  84012: 'Sabik', 58001: 'Phecda', 35904: 'Aludra', 45941: 'Markeb', 4427: 'Navi', 113963: 'Markab',
  102488: 'Aljanah', 78820: 'Acrab', 54872: 'Zosma', 77070: 'Unukalhai', 25985: 'Arneb', 6686: 'Ruchbah',
  105199: 'Alderamin', 14135: 'Menkar', 74785: 'Zubeneschamali', 72622: 'Zubenelgenubi', 63608: 'Vindemiatrix',
  59803: 'Gienah', 61359: 'Kraz', 60965: 'Algorab', 95947: 'Albireo', 72105: 'Izar', 63125: 'Cor Caroli',
  84345: 'Rasalgethi', 80816: 'Kornephoros', 17702: 'Alcyone', 10826: 'Mira', 59774: 'Megrez', 68756: 'Thuban',
  88635: 'Alnasl', 89931: 'Kaus Media', 93506: 'Ascella', 30343: 'Tejat', 8903: 'Sheratan', 9640: 'Almach',
  65477: 'Alcor', 25606: 'Nihal', 116727: 'Errai', 106032: 'Alfirk', 109074: 'Sadalmelik', 106278: 'Sadalsuud',
  107556: 'Deneb Algedi', 36188: 'Gomeisa',
};

const round = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };

// Linear proper-motion propagation (good to well under 1″ over 34 yr for these stars, except
// the few fastest movers, which are still within a few arcseconds).
export function propagate(ra, dec, pmRaMasYr, pmDeMasYr, years) {
  const d = dec + (pmDeMasYr * years) / 3.6e6;
  const r = ra + (pmRaMasYr * years) / 3.6e6 / Math.max(1e-6, Math.cos((dec * Math.PI) / 180));
  return [((r % 360) + 360) % 360, Math.max(-90, Math.min(90, d))];
}

async function main() {
  const adql = `SELECT n.hip, n.ra, n.dec, n.pm_ra, n.pm_de, n.hp_mag, n.b_v, h.vmag
    FROM public.hipparcos_newreduction AS n JOIN public.hipparcos AS h ON h.hip = n.hip
    WHERE n.hp_mag < ${HP_LIMIT}`.replace(/\s+/g, ' ');
  const url = `${TAP}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(adql)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error('Gaia archive HTTP ' + res.status);
  const lines = (await res.text()).trim().split(/\r?\n/);
  const head = lines.shift().split(',');
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const rows = [];
  for (const line of lines) {
    const c = line.split(',');
    const hip = +c[col.hip], hp = +c[col.hp_mag];
    const v = c[col.vmag] === '' ? hp : +c[col.vmag];
    const bv = c[col.b_v] === '' ? 0.6 : +c[col.b_v];
    const [ra, dec] = propagate(+c[col.ra], +c[col.dec], +c[col.pm_ra] || 0, +c[col.pm_de] || 0, EPOCH_TO - EPOCH_FROM);
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(v)) continue;
    rows.push([hip, round(ra, 4), round(dec, 4), round(v, 2), round(bv, 2)]);
  }
  rows.sort((a, b) => a[3] - b[3]);
  const names = {};
  for (const [hip, name] of Object.entries(NAMES)) {
    const r = rows.find(x => x[0] === +hip);
    if (!r) console.warn('named star missing:', hip, name);
    else { names[hip] = name; if (r[3] > 4.5) console.warn('named star fainter than expected:', name, r); }
  }
  const out = { credit: CREDIT, epoch: EPOCH_TO, fields: ['hip', 'ra', 'dec', 'vmag', 'bv'], names, stars: rows };
  const path = fileURLToPath(new URL('../web/app/data/stars.json', import.meta.url));
  writeFileSync(path, JSON.stringify(out));
  console.log(`${rows.length} stars (Hp < ${HP_LIMIT}), ${Object.keys(names).length} names -> ${path}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(err => { console.error(err); process.exit(1); });
