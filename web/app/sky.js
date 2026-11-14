// Coordinate conversions for the details panel: galactic, ecliptic, constellation,
// and (for an observer the user chooses) altitude/azimuth, rise/transit/set.
// All maths runs in the browser; nothing is sent anywhere.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const norm360 = (x) => ((x % 360) + 360) % 360;

function toVec(ra, dec) {
  const a = ra * D2R, d = dec * D2R;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}
function fromVec([x, y, z]) {
  return [norm360(Math.atan2(y, x) * R2D), Math.asin(Math.max(-1, Math.min(1, z))) * R2D];
}
const mul = (M, v) => [0, 1, 2].map(i => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);

// ICRS -> Galactic (Hipparcos definition, as used by Astropy).
const GAL = [
  [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
  [+0.4941094278755837, -0.4448296299600112, +0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, +0.4559837761750669],
];
export function toGalactic(ra, dec) { const [l, b] = fromVec(mul(GAL, toVec(ra, dec))); return { l, b }; }

// ICRS -> mean ecliptic of J2000 (obliquity 84381.406″, IAU 2006).
const EPS = (84381.406 / 3600) * D2R;
export function toEcliptic(ra, dec) {
  const [x, y, z] = toVec(ra, dec);
  const [lon, lat] = fromVec([x, Math.cos(EPS) * y + Math.sin(EPS) * z, -Math.sin(EPS) * y + Math.cos(EPS) * z]);
  return { lon, lat };
}

// IAU 1976 precession from J2000 to another epoch (Julian date).
export function precessFromJ2000(ra, dec, jd) {
  const T = (jd - 2451545.0) / 36525;
  const as = (s) => (s / 3600) * D2R;
  const zeta = as(2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3);
  const z = as(2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3);
  const th = as(2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3);
  const [cz, sz, cZ, sZ, ct, st] = [Math.cos(zeta), Math.sin(zeta), Math.cos(z), Math.sin(z), Math.cos(th), Math.sin(th)];
  const P = [
    [cZ * ct * cz - sZ * sz, -cZ * ct * sz - sZ * cz, -cZ * st],
    [sZ * ct * cz + cZ * sz, -sZ * ct * sz + cZ * cz, -sZ * st],
    [st * cz, -st * sz, ct],
  ];
  return fromVec(mul(P, toVec(ra, dec)));
}

const B1875_JD = 2405889.258550475;
let CON = null;
export async function loadConstellations(fetchFn = fetch, url = new URL('./data/constellations.json', import.meta.url)) {
  if (!CON) CON = await fetchFn(url).then(r => r.json());
  return CON;
}
export function setConstellationData(data) { CON = data; }

// IAU constellation (Roman 1987 method). Needs loadConstellations() first.
export function constellation(ra, dec) {
  if (!CON) return null;
  const [r1875, d1875] = precessFromJ2000(ra, dec, B1875_JD);
  const h = r1875 / 15;
  for (const [lo, hi, dlo, abbr] of CON.rows) {
    if (d1875 >= dlo && h >= lo && h < hi) return { abbr, name: CON.names[abbr] || abbr };
  }
  return null;
}

// ---- observer: local sidereal time, alt/az, rise/transit/set ------------------------
export function julianDate(date) { return date.getTime() / 86400000 + 2440587.5; }

export function gmstDeg(date) {
  const jd = julianDate(date), T = (jd - 2451545.0) / 36525;
  return norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T ** 3) / 38710000);
}

// Catalogue (J2000) RA/Dec -> RA/Dec of date, which is what the local sky uses
// (precession moves stars ~0.36° between 2000 and 2026).
export function ofDate(ra, dec, date) { return precessFromJ2000(ra, dec, julianDate(date)); }

// Altitude/azimuth (azimuth from north through east), ignoring refraction.
// ra/dec are J2000 (catalogue) unless { j2000: false } says they are already of date.
export function altAz(ra, dec, lat, lon, date, { j2000 = true } = {}) {
  if (j2000) [ra, dec] = ofDate(ra, dec, date);
  const H = norm360(gmstDeg(date) + lon - ra) * D2R;
  const d = dec * D2R, p = lat * D2R;
  const sinAlt = Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(p) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  const az = Math.atan2(-Math.sin(H) * Math.cos(d), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(H));
  return { alt: alt * R2D, az: norm360(az * R2D) };
}

// Transit and rise/set for J2000 ra/dec. h0 = -0.5667° (standard horizon: refraction at
// the horizon, as in DESIGN.md). If the object is up now, this is the current pass (rise in
// the past, set later today); otherwise the next pass (rise, transit, set all ahead).
// Returns { transit, rise, set, transitAlt, always: 'up'|'down'|null }.
export function riseTransitSet(ra, dec, lat, lon, date, h0 = -0.5667, { j2000 = true } = {}) {
  if (j2000) [ra, dec] = ofDate(ra, dec, date);
  const SIDEREAL = 0.99726957; // solar days per sidereal day
  const DAY = 86400000;
  const Hnow = norm360(gmstDeg(date) + lon - ra); // hour angle now (deg), 0..360
  const Hs = Hnow >= 180 ? Hnow - 360 : Hnow;    // signed: <0 before transit, >0 after
  const transitAlt = 90 - Math.abs(lat - dec);
  const at = (hDeg) => new Date(date.getTime() + (hDeg / 360) * SIDEREAL * DAY); // time when H = Hnow + hDeg
  const nextTransit = at((360 - Hnow) % 360);
  const cosH = (Math.sin(h0 * D2R) - Math.sin(lat * D2R) * Math.sin(dec * D2R)) / (Math.cos(lat * D2R) * Math.cos(dec * D2R));
  if (cosH < -1) return { transit: nextTransit, rise: null, set: null, transitAlt, always: 'up' };
  if (cosH > 1) return { transit: nextTransit, rise: null, set: null, transitAlt, always: 'down' };
  const half = Math.acos(cosH) * R2D; // semi-diurnal arc (deg of hour angle)
  const transit = Math.abs(Hs) < half ? at(-Hs) : nextTransit; // up now -> this pass's transit
  const Hdays = (half / 360) * SIDEREAL;
  const rise = new Date(transit.getTime() - Hdays * DAY);
  const set = new Date(transit.getTime() + Hdays * DAY);
  return { transit, rise, set, transitAlt, always: null, up: Math.abs(Hs) < half };
}

// Sun position (low precision, ~0.01°) for "is it dark?".
export function sunRaDec(date) {
  const n = julianDate(date) - 2451545.0;
  const L = norm360(280.460 + 0.9856474 * n), g = norm360(357.528 + 0.9856003 * n) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  return { ra: norm360(Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * R2D), dec: Math.asin(Math.sin(eps) * Math.sin(lam)) * R2D };
}

// Hours tonight (next 24 h, 10-minute steps) when the spot is above minAlt while the Sun is
// below -12° (nautical dark). Returns { hours, bestTime, bestAlt }.
export function visibleTonight(ra, dec, lat, lon, from, minAlt = 20) {
  let mins = 0, best = null;
  for (let k = 0; k < 144; k++) {
    const t = new Date(from.getTime() + k * 600000);
    const s = sunRaDec(t);
    if (altAz(s.ra, s.dec, lat, lon, t, { j2000: false }).alt > -12) continue; // Sun is already of date
    const a = altAz(ra, dec, lat, lon, t).alt;
    if (a >= minAlt) { mins += 10; if (!best || a > best.alt) best = { t, alt: a }; }
  }
  return { hours: mins / 60, bestTime: best?.t ?? null, bestAlt: best?.alt ?? null };
}
