// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Small-body provider for the planetarium (extras.js hook): the four brightest asteroids from
// JPL Horizons through our relay (/jpl/horizons). One request per asteroid per UTC day (hourly
// geocentric J2000 RA/Dec, V magnitude, distance), cached; positions in between are linear.
// PRIVACY: only the date goes to JPL. The ephemeris is geocentric (CENTER 500@399); the page
// turns it into altitude and azimuth for the chosen place locally.
import { registerSmallBodyProvider } from './extras.js';

export const BRIGHT = [
  { cmd: '1;', name: '1 Ceres' }, { cmd: '2;', name: '2 Pallas' }, { cmd: '3;', name: '3 Juno' }, { cmd: '4;', name: '4 Vesta' },
];
const cache = new Map(); // `${cmd}|${day}` -> Promise<rows | null>
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function horizonsUrl(base, cmd, day) {
  const next = new Date(Date.parse(day + 'T00:00:00Z') + 86400000);
  const p = new URLSearchParams({ format: 'json', COMMAND: `'${cmd}'`, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'OBSERVER',
    CENTER: "'500@399'", START_TIME: `'${day} 00:00'`, STOP_TIME: `'${dayOf(next)} 00:00'`, STEP_SIZE: "'1 h'",
    QUANTITIES: "'1,9,20'", ANG_FORMAT: 'DEG', CSV_FORMAT: 'YES' });
  return `${base}/jpl/horizons?${p}`;
}

const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
// Rows between $$SOE and $$EOE: "2026-Nov-14 00:00, , , RA, DEC, APmag, S-brt, delta, deldot,"
export function parseHorizons(text) {
  const a = text.indexOf('$$SOE'), b = text.indexOf('$$EOE');
  if (a < 0 || b < a) return null;
  const rows = [];
  for (const line of text.slice(a + 5, b).split('\n')) {
    const c = line.split(',').map(s => s.trim());
    const m = /^(\d{4})-([A-Z][a-z]{2})-(\d\d) (\d\d):(\d\d)$/.exec(c[0] || '');
    if (!m || !(m[2] in MON)) continue;
    const t = Date.UTC(+m[1], MON[m[2]], +m[3], +m[4], +m[5]);
    const ra = Number(c[3]), dec = Number(c[4]), mag = Number(c[5]), dist = Number(c[7]);
    if (Number.isFinite(ra) && Number.isFinite(dec)) rows.push({ t, ra, dec, mag: Number.isFinite(mag) ? mag : null, distAU: Number.isFinite(dist) ? dist : null });
  }
  return rows.length ? rows : null;
}

// Linear between the two hourly rows around `ms` (RA unwrapped across 0/360).
export function interpolate(rows, ms) {
  if (!rows?.length || ms < rows[0].t || ms > rows[rows.length - 1].t) return null;
  let i = rows.findIndex(r => r.t >= ms); if (i <= 0) return { ...rows[0] };
  const p = rows[i - 1], q = rows[i], f = (ms - p.t) / (q.t - p.t);
  let dra = q.ra - p.ra; if (dra > 180) dra -= 360; if (dra < -180) dra += 360;
  return { ra: ((p.ra + dra * f) % 360 + 360) % 360, dec: p.dec + (q.dec - p.dec) * f, mag: p.mag, distAU: p.distAU };
}

function rowsFor(base, cmd, day, fetchFn) {
  const k = `${base}|${cmd}|${day}`;
  if (!cache.has(k)) {
    const job = fetchFn(horizonsUrl(base, cmd, day), { signal: AbortSignal.timeout(20000) })
      .then(r => (r.ok ? r.json() : null)).then(j => (j?.result ? parseHorizons(j.result) : null)).catch(() => null);
    cache.set(k, job);
    job.then(v => { if (!v) setTimeout(() => cache.delete(k), 5 * 60000)?.unref?.(); }); // failed: try again in 5 minutes, not sooner (unref: never holds Node open in tests)
  }
  return cache.get(k);
}

export function makeProvider({ base = '', fetchFn = (...a) => fetch(...a) } = {}) {
  return async (date) => {
    const day = dayOf(date), out = [];
    const lists = await Promise.all(BRIGHT.map(b => rowsFor(base, b.cmd, day, fetchFn)));
    BRIGHT.forEach((b, i) => { const p = interpolate(lists[i], date.getTime()); if (p) out.push({ name: b.name, ...p }); });
    return out;
  };
}

if (typeof window !== 'undefined' && typeof location !== 'undefined') registerSmallBodyProvider(makeProvider({ base: location.origin }));
