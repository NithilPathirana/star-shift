// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Fetches the distance shown for a demo target from SIMBAD (Gaia DR3 parallax) and saves it, with its
// citation, to web/app/distances.js. Nothing is typed by hand: run `node tools/fetch_distances.mjs`.
// RW Aurigae (judging panel round 4, item 4): SIMBAD's "V* RW Aur" (the system) still carries the old
// Hipparcos parallax 15.42 ± 3.69 mas (2007A&A...474..653V, ~212 light years); the Gaia DR3 parallax of
// its brighter star RW Aur A is the one shown. If SIMBAD does not answer, the file is not changed.
import { writeFileSync } from 'node:fs';

const SIMBAD = 'https://simbad.harvard.edu/simbad/sim-tap/sync';
const WANT = { 'rw-aur': { ident: 'V* RW Aur A', label: 'RW Aur A (the brighter star of the RW Aurigae pair)' } };

async function tap(q) {
  const u = `${SIMBAD}?REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=${encodeURIComponent(q)}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`SIMBAD HTTP ${r.status}`);
  const j = await r.json();
  return j.data.map(row => Object.fromEntries(j.metadata.map((m, i) => [m.name, row[i]])));
}

const out = {};
for (const [key, w] of Object.entries(WANT)) {
  const rows = await tap(`SELECT b.oid, b.main_id, b.plx_value, b.plx_err, b.plx_bibcode, i2.id AS gaia FROM basic b JOIN ident i ON i.oidref = b.oid JOIN ident i2 ON i2.oidref = b.oid WHERE i.id = '${w.ident}' AND i2.id LIKE 'Gaia DR3 %'`);
  const r = rows[0];
  if (!r || !(r.plx_value > 0)) throw new Error(`${key}: no parallax in SIMBAD`);
  if (r.plx_bibcode !== '2020yCat.1350....0G') throw new Error(`${key}: SIMBAD's parallax is not Gaia DR3 (${r.plx_bibcode})`);
  const pc = 1000 / r.plx_value, ly = pc * 3.26156;
  out[key] = {
    plx: r.plx_value, plxErr: r.plx_err, gaiaDr3: r.gaia.replace('Gaia DR3 ', ''), component: w.label, simbadId: r.main_id,
    bibcode: r.plx_bibcode, pc: +pc.toFixed(1), ly: Math.round(ly),
    cite: `Gaia DR3 ${r.gaia.replace('Gaia DR3 ', '')} (${r.main_id}), parallax ${r.plx_value} ± ${r.plx_err} mas, via SIMBAD`,
    fetched: new Date().toISOString().slice(0, 10),
  };
}
const file = new URL('../web/app/distances.js', import.meta.url);
writeFileSync(file, `// Made by tools/fetch_distances.mjs (do not edit by hand). AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Distances shown for demo targets whose SIMBAD entry carries an old parallax: Gaia DR3 parallax via SIMBAD, cited.
// Distance = 1000 / parallax parsecs, 3.26156 light years per parsec.
export const DISTANCES = ${JSON.stringify(out, null, 2)};
`);
console.log(JSON.stringify(out, null, 2));
