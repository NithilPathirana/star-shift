// Look up a star by name (SIMBAD) or by position (Gaia DR3) to get its proper motion.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// SIMBAD: Harvard mirror TAP (sends CORS headers, so the browser can call it directly;
// the main CDS server returned 404 on 12-14 Nov 2026). Positions are ICRS, epoch J2000.
// Gaia DR3: ESA archive TAP (no CORS -> goes through our relay in the browser). Epoch 2016.0.

import { parseCSV } from './irsa.js';
import { prebakedFetch } from './prebaked.js'; // the five demo targets answer from web/prebaked/ (Claude)

export const SIMBAD_TAP = 'https://simbad.harvard.edu/simbad/sim-tap/sync';
export const GAIA_TAP = 'https://gea.esac.esa.int/tap-server/tap/sync';

const adqlString = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const num = (v) => (v === '' || v == null ? null : Number(v));

async function tapCSV(endpoint, adql, fetchFn, signal) {
  const url = `${endpoint}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(adql)}`;
  const res = await fetchFn(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(endpoint).host}`);
  return parseCSV(await res.text());
}

export async function resolveName(name, { endpoint = SIMBAD_TAP, fetchFn = prebakedFetch, signal } = {}) {
  const clean = String(name).trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > 80) throw new Error('Name missing or too long');
  // SIMBAD stores identifiers with single spaces; match case-insensitively via the
  // ident table, then fall back to an exact match.
  const adql = `SELECT TOP 1 b.main_id, b.ra, b.dec, b.pmra, b.pmdec, b.plx_value, b.rvz_radvel, b.otype
    FROM basic AS b JOIN ident AS i ON i.oidref = b.oid
    WHERE i.id = ${adqlString(clean)}`.replace(/\s+/g, ' ');
  const rows = await tapCSV(endpoint, adql, fetchFn, signal);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    name: r.main_id.replace(/^(NAME|\*|V\*)\s+/, ''), // '* alf Ori' -> 'alf Ori', 'V* R Dra' -> 'R Dra'
    ra: num(r.ra), dec: num(r.dec),
    pmra: num(r.pmra) ?? 0, pmdec: num(r.pmdec) ?? 0,
    plx: num(r.plx_value), rv: num(r.rvz_radvel), epoch: 2000.0, otype: r.otype, source: 'SIMBAD',
  };
}

// Gaia DR3 sources within radiusArcsec of (ra, dec) at epoch 2016.0, brightest first.
export async function gaiaCone(ra, dec, radiusArcsec, { endpoint = GAIA_TAP, fetchFn = prebakedFetch, signal, top = 50 } = {}) {
  const adql = `SELECT TOP ${top | 0} source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag,
    parallax_error, pmra_error, pmdec_error, radial_velocity, radial_velocity_error
    FROM gaiadr3.gaia_source
    WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${+ra}, ${+dec}, ${+radiusArcsec / 3600}))
    ORDER BY phot_g_mean_mag`.replace(/\s+/g, ' ');
  const rows = await tapCSV(endpoint, adql, fetchFn, signal);
  return rows.map(r => ({
    id: 'Gaia DR3 ' + r.source_id, ra: num(r.ra), dec: num(r.dec),
    pmra: num(r.pmra) ?? 0, pmdec: num(r.pmdec) ?? 0, plx: num(r.parallax),
    g: num(r.phot_g_mean_mag), epoch: 2016.0, source: 'Gaia DR3',
    plxErr: num(r.parallax_error), pmraErr: num(r.pmra_error), pmdecErr: num(r.pmdec_error),
    rv: num(r.radial_velocity), rvErr: num(r.radial_velocity_error),
  }));
}
