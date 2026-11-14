// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Planetarium astronomy: Sun, Moon and planets from astronomy-engine (MIT, Don Cross),
// Hipparcos stars rotated from the J2000 equator to the local horizon, and the reverse
// (a point on the sky back to J2000 RA/Dec). Runs in the browser and in Node (tests).
// Local horizontal frame used everywhere here: x = East, y = North, z = Up (unit vectors).
import * as A from '../../vendor/astronomy-engine-2.1.19/astronomy.js';

export { A };
export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const norm360 = (x) => ((x % 360) + 360) % 360;

export const BODIES = [
  { key: 'Sun', name: 'Sun' }, { key: 'Moon', name: 'Moon' },
  { key: 'Mercury', name: 'Mercury' }, { key: 'Venus', name: 'Venus' }, { key: 'Mars', name: 'Mars' },
  { key: 'Jupiter', name: 'Jupiter' }, { key: 'Saturn', name: 'Saturn' },
  { key: 'Uranus', name: 'Uranus' }, { key: 'Neptune', name: 'Neptune' },
];
// Mean radii (km) for apparent size.
const RADIUS_KM = { Sun: 695700, Moon: 1737.4, Mercury: 2439.7, Venus: 6051.8, Mars: 3389.5, Jupiter: 69911, Saturn: 58232, Uranus: 25362, Neptune: 24622 };
const AU_KM = 149597870.7;

export function observer(lat, lon, elevM = 0) { return new A.Observer(lat, lon, elevM); }

export function altAzToVec(alt, az) {
  const a = alt * D2R, z = az * D2R, c = Math.cos(a);
  return [c * Math.sin(z), c * Math.cos(z), Math.sin(a)];
}
export function vecToAltAz(e, n, u) {
  const r = Math.hypot(e, n, u) || 1;
  return { alt: Math.asin(Math.max(-1, Math.min(1, u / r))) * R2D, az: norm360(Math.atan2(e, n) * R2D) };
}
function raDecToVec(raDeg, decDeg) {
  const a = raDeg * D2R, d = decDeg * D2R, c = Math.cos(d);
  return [c * Math.cos(a), c * Math.sin(a), Math.sin(d)];
}

// 3×3 matrix M (row-major) so that [E,N,U] = M · [x,y,z]_J2000 for this time and place.
// astronomy-engine's HOR frame is x = North, y = West, z = Zenith; its rot[i][j] is applied
// as out_j = Σ_i rot[i][j]·in_i.
export function horMatrix(date, obs) {
  const R = A.Rotation_EQJ_HOR(A.MakeTime(date), obs).rot;
  const col = (j) => [R[0][j], R[1][j], R[2][j]]; // output component j
  const north = col(0), west = col(1), up = col(2);
  return [west.map(v => -v), north, up];
}

// Atmospheric refraction (astronomy-engine "normal" model), degrees to add to the true altitude.
export const refraction = (altDeg) => A.Refraction('normal', altDeg);

// Hipparcos rows [hip, ra, dec, vmag, bv] -> packed unit vectors in J2000 (Float32Array, 3 per star).
export function packStars(rows) {
  const v = new Float32Array(rows.length * 3);
  rows.forEach((s, i) => { const p = raDecToVec(s[1], s[2]); v[3 * i] = p[0]; v[3 * i + 1] = p[1]; v[3 * i + 2] = p[2]; });
  return v;
}

// Rotate all stars to the local horizon (with refraction near and above the horizon).
// out: Float32Array(3n) of E,N,U. Returns out.
export function starsToHorizon(eqj, M, out = new Float32Array(eqj.length)) {
  const [a, b, c] = M;
  for (let i = 0; i < eqj.length; i += 3) {
    const x = eqj[i], y = eqj[i + 1], z = eqj[i + 2];
    let e = a[0] * x + a[1] * y + a[2] * z, n = b[0] * x + b[1] * y + b[2] * z, u = c[0] * x + c[1] * y + c[2] * z;
    if (u > -0.035) { // within ~2° below the horizon or higher: lift by refraction
      const alt = Math.asin(Math.min(1, u)) * R2D, alt2 = alt + refraction(alt);
      const h = Math.hypot(e, n) || 1e-9, ch = Math.cos(alt2 * D2R);
      e = e / h * ch; n = n / h * ch; u = Math.sin(alt2 * D2R);
    }
    out[i] = e; out[i + 1] = n; out[i + 2] = u;
  }
  return out;
}

// Apparent alt/az of a J2000 RA/Dec (deg) for one place and time (refraction on).
export function starAltAz(raDeg, decDeg, date, obs) {
  const M = horMatrix(date, obs), p = raDecToVec(raDeg, decDeg), o = new Float32Array(3);
  starsToHorizon(Float32Array.from(p), M, o);
  return vecToAltAz(o[0], o[1], o[2]);
}

// Sun, Moon and planets: apparent alt/az (topocentric, refraction on), J2000 RA/Dec for the
// main app's link, magnitude, apparent diameter and (Moon) illuminated fraction.
export function bodies(date, obs) {
  const t = A.MakeTime(date);
  return BODIES.map(({ key, name }) => {
    const body = A.Body[key];
    const od = A.Equator(body, t, obs, true, true);   // of date: for the horizon
    const j2 = A.Equator(body, t, obs, false, true);  // J2000: for the RA/Dec link
    const h = A.Horizon(t, obs, od.ra, od.dec, 'normal');
    let mag = null, phase = null;
    try { const il = A.Illumination(body, t); mag = il.mag; phase = il.phase_fraction; } catch { /* Sun has no phase */ }
    if (key === 'Sun') { mag = -26.74; phase = 1; }
    const diamDeg = 2 * Math.atan(RADIUS_KM[key] / (od.dist * AU_KM)) * R2D;
    return { key, name, kind: key === 'Sun' ? 'sun' : key === 'Moon' ? 'moon' : 'planet',
      alt: h.altitude, az: h.azimuth, ra: norm360(j2.ra * 15), dec: j2.dec, distAU: od.dist, mag, phase, diamDeg };
  });
}

// Altitude of the Sun (deg, refraction on): daytime test.
export function sunAltitude(date, obs) {
  const t = A.MakeTime(date), od = A.Equator(A.Body.Sun, t, obs, true, true);
  return A.Horizon(t, obs, od.ra, od.dec, 'normal').altitude;
}

// A point on the sky (apparent alt/az, refraction included) back to J2000 RA/Dec in degrees.
export function altAzToRaDec(alt, az, date, obs) {
  let trueAlt = alt;
  if (alt > -2) trueAlt = alt + A.InverseRefraction('normal', alt);
  const [e, n, u] = altAzToVec(trueAlt, az);
  const M = horMatrix(date, obs); // orthonormal: inverse = transpose
  const x = M[0][0] * e + M[1][0] * n + M[2][0] * u, y = M[0][1] * e + M[1][1] * n + M[2][1] * u, z = M[0][2] * e + M[1][2] * n + M[2][2] * u;
  return { ra: norm360(Math.atan2(y, x) * R2D), dec: Math.asin(Math.max(-1, Math.min(1, z))) * R2D };
}

// Local sidereal time (hours), for the readout.
export function lstHours(date, lon) { return norm360(A.SiderealTime(A.MakeTime(date)) * 15 + lon) / 15; }

// Star colour from B−V: DESIGN.md section 18 table, interpolated linearly.
const BV_STOPS = [[-0.2, [0xB4, 0xC8, 0xFF]], [0.0, [0xEE, 0xF0, 0xF2]], [0.4, [0xFF, 0xF1, 0xDD]], [0.8, [0xFF, 0xDD, 0xB0]], [1.2, [0xFF, 0xC4, 0x8C]], [1.6, [0xFF, 0xA8, 0x6E]]];
export function bvColor(bv) {
  const t = Math.max(-0.2, Math.min(1.6, Number.isFinite(bv) ? bv : 0.6));
  for (let i = 1; i < BV_STOPS.length; i++) {
    if (t <= BV_STOPS[i][0]) {
      const [t0, c0] = BV_STOPS[i - 1], [t1, c1] = BV_STOPS[i], f = (t - t0) / (t1 - t0);
      return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * f)).join(',')})`;
    }
  }
  return 'rgb(255,168,110)';
}
// Star size (CSS px) and alpha from V magnitude: DESIGN.md section 18.
export const starSize = (v) => Math.max(1.2, Math.min(7, 1.2 + (6.5 - v) * 0.85));
export const starAlpha = (v) => Math.max(0.25, Math.min(1, Math.pow(10 ** (-0.4 * v) / 10 ** (0.6), 0.35)));

// Rise, highest point (transit) and set of a body or a fixed J2000 point, next 24 h after
// `date` (if it is up now, the current pass: rise searched from 1 day back).
export function passTimes(target, date, obs) {
  let body;
  if (target.kind === 'sun' || target.kind === 'moon' || target.kind === 'planet') body = A.Body[target.key];
  else { body = A.Body.Star1; A.DefineStar(body, target.ra / 15, target.dec, 1000); }
  const t = A.MakeTime(date);
  const od = A.Equator(body, t, obs, true, true), alt = A.Horizon(t, obs, od.ra, od.dec, 'normal').altitude;
  const up = alt > 0;
  const from = up ? t.AddDays(-1) : t;
  let rise = A.SearchRiseSet(body, obs, +1, from, up ? 1 : 1.2);
  if (rise && up && rise.ut > t.ut) rise = null;
  const set = A.SearchRiseSet(body, obs, -1, t, 1.2);
  const tr = A.SearchHourAngle(body, obs, 0, rise && up ? rise : t, +1);
  let always = null;
  if (!rise && !set) always = up ? 'up' : 'down';
  return { up, rise: rise ? rise.date : null, set: set ? set.date : null,
    transit: tr ? tr.time.date : null, transitAlt: tr ? tr.hor.altitude : null, always };
}
