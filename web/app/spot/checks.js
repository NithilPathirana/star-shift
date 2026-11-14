// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// "Spot a mover" (DESIGN.md 34): the two network checks. Each takes `fetchFn`, so tests run them
// against canned answers. Nothing here sends anything about the user: only sky positions and dates.
//  - known stars: Gaia DR3 through our relay (/gaia/tap/sync) and SIMBAD (Harvard mirror, CORS);
//  - known asteroids: JPL Small-Body Identification through our relay (/jpl/sb_ident).

import { gaiaCone, SIMBAD_TAP } from '../../core/resolve.js';
import { parseCSV } from '../../core/irsa.js';
import { prebakedFetch } from '../../core/prebaked.js'; // the five demo targets answer from web/prebaked/ (Claude)
import {
  GAIA_RADIUS_ARCSEC, SIMBAD_RADIUS_ARCSEC, JPL_TIMEOUT_MS, gaiaStars, simbadStars, simbadConeADQL, decideStar,
  sbIdentPath, parseSbIdent, decideAsteroid,
} from './logic.js';

// A signal that aborts on the caller's signal or after `ms`.
export function timeoutSignal(signal, ms) {
  const t = AbortSignal.timeout(ms);
  return signal && AbortSignal.any ? AbortSignal.any([signal, t]) : (signal || t);
}

export async function fetchSimbadCone(ra, dec, { fetchFn = prebakedFetch, signal, endpoint = SIMBAD_TAP, radius = SIMBAD_RADIUS_ARCSEC } = {}) {
  const url = `${endpoint}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(simbadConeADQL(ra, dec, radius))}`;
  const res = await fetchFn(url, { signal });
  if (!res.ok) throw new Error(`SIMBAD HTTP ${res.status}`);
  const text = await res.text();
  if (!/^\s*"?main_id/.test(text)) throw new Error('SIMBAD sent an unreadable answer');
  return parseCSV(text);
}

// at: { ra, dec } of the ring; epochs: [{ mjd, label }] of the blinked seasons.
export async function runStarCheck({ at, epochs, base, fetchFn = prebakedFetch, signal, timeoutMs = 25000 }) {
  const [g, s] = await Promise.allSettled([
    gaiaCone(at.ra, at.dec, GAIA_RADIUS_ARCSEC, { endpoint: `${base}/gaia/tap/sync`, fetchFn, top: 400, signal: timeoutSignal(signal, timeoutMs) }),
    fetchSimbadCone(at.ra, at.dec, { fetchFn, signal: timeoutSignal(signal, timeoutMs) }),
  ]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const gaia = g.status === 'fulfilled' ? { ok: true, stars: gaiaStars(g.value) } : { ok: false, error: String(g.reason?.message || g.reason) };
  const simbad = s.status === 'fulfilled' ? { ok: true, stars: simbadStars(s.value) } : { ok: false, error: String(s.reason?.message || s.reason) };
  return { ...decideStar({ gaia, simbad }, at, epochs), gaia: { ok: gaia.ok, n: gaia.stars?.length ?? 0, error: gaia.error }, simbad: { ok: simbad.ok, n: simbad.stars?.length ?? 0, error: simbad.error } };
}

// One sb_ident request; on a non-404 failure with the MPC 500 observer, ask again with the
// geocentric state vector (as the Asteroid Spotter does).
async function askJpl({ at, season, base, fetchFn, signal, timeoutMs }) {
  const budget = timeoutSignal(signal, timeoutMs); // one budget for both observer tries
  const one = async (observer) => {
    const res = await fetchFn(base + sbIdentPath({ ra: at.ra, dec: at.dec, utc: season.utc, observer }), { signal: budget });
    if (!res.ok) { res.body?.cancel?.().catch(() => {}); return { ok: false, status: res.status }; }
    let json; try { json = await res.json(); } catch { return { ok: false, error: 'an unreadable answer' }; }
    if (!json?.signature) return { ok: false, error: json?.message || 'an unexpected answer' };
    return { ok: true, rows: parseSbIdent(json), observer };
  };
  const base1 = { label: season.label, mjd: season.mjd, utc: season.utc };
  try {
    let r = await one('mpc-500');
    if (!r.ok && r.status !== 404 && !budget.aborted) r = await one('geocentric-state');
    return { ...base1, ...r };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { ...base1, ok: false, error: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? `no reply in ${Math.round(timeoutMs / 1000)} s` : String(e?.message || e) };
  }
}

// seasons: [{ label, mjd, utc }] (the blinked seasons' middle images).
export async function runAsteroidCheck({ at, seasons, base, fetchFn = prebakedFetch, signal, timeoutMs = JPL_TIMEOUT_MS }) {
  const results = await Promise.all(seasons.map(season => askJpl({ at, season, base, fetchFn, signal, timeoutMs })));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return { ...decideAsteroid(results), results };
}
