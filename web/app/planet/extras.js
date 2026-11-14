// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// ===================== HOOK: bright asteroids and comets from JPL =====================
// Another team member is building the JPL feed. This planetarium draws whatever the
// registered providers return, as hollow 6 px diamonds tagged JPL (DESIGN.md section 26).
//
// How to plug in (from any module loaded by planetarium.html):
//   import { registerSmallBodyProvider } from './app/planet/extras.js';
//   registerSmallBodyProvider(async (date) => [
//     { name: '4 Vesta', ra: 123.4, dec: 12.3, mag: 6.1, distAU: 1.4 },  // J2000 RA/Dec in degrees,
//   ]);                                                                     // geocentric, for `date`
//
// PRIVACY RULE: a provider gets only the time. Never send the user's place to JPL or anywhere;
// ask JPL for geocentric positions and the planetarium turns them into alt/az locally.
// Topocentric parallax is ignored here (fine for main-belt asteroids and most comets; a very
// close near-Earth object could be off by up to a few arcminutes).
// ======================================================================================

const providers = [];
const listeners = new Set();

export function registerSmallBodyProvider(fn) {
  providers.push(fn);
  listeners.forEach(cb => cb());
  return () => { const i = providers.indexOf(fn); if (i >= 0) providers.splice(i, 1); listeners.forEach(cb => cb()); };
}

export function onProvidersChanged(cb) { listeners.add(cb); return () => listeners.delete(cb); }

// Calls every provider; bad rows and failing providers are skipped (never guessed).
export async function smallBodies(date) {
  const out = [];
  for (const fn of providers) {
    try {
      const rows = await fn(new Date(date.getTime()));
      for (const r of rows || []) {
        if (r && typeof r.name === 'string' && Number.isFinite(r.ra) && Number.isFinite(r.dec)) {
          out.push({ key: 'sb:' + r.name, name: r.name, kind: 'small', ra: r.ra, dec: r.dec,
            mag: Number.isFinite(r.mag) ? r.mag : null, distAU: Number.isFinite(r.distAU) ? r.distAU : null, source: 'JPL' });
        }
      }
    } catch { /* provider failed: show nothing from it */ }
  }
  return out;
}

if (typeof window !== 'undefined') window.StarShiftPlanetarium = Object.assign(window.StarShiftPlanetarium || {}, { registerSmallBodyProvider });
