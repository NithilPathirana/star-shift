// Propagate a star's position with its proper motion to any date.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Linear motion on the sky as a 3-D unit vector (no radial velocity / perspective
// acceleration: for Barnard's Star that term is ~0.0012"/yr^2, far below a 6.15" pixel).
// Annual parallax is not applied by propagate() (it is <0.55", <0.1 SPHEREx pixel), but
// measureMotion removes it before fitting (parallaxShift below): with ~6-monthly seasons it
// alternates sign between seasons and leaks into a straight-line fit.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const MAS2RAD = D2R / 3.6e6;

export const MJD_J2000 = 51544.5; // 2000-01-01T12:00 TT
export const DAYS_PER_YEAR = 365.25;

export function epochYearToMjd(year) {
  return MJD_J2000 + (year - 2000) * DAYS_PER_YEAR;
}
export function mjdToEpochYear(mjd) {
  return 2000 + (mjd - MJD_J2000) / DAYS_PER_YEAR;
}
export function mjdToDate(mjd) {
  return new Date(Date.UTC(1858, 10, 17) + mjd * 86400000);
}

// star: { ra, dec (deg), pmra (mas/yr, includes cos dec), pmdec (mas/yr), epoch (Julian year) }
export function propagate(star, mjd) {
  const pmra = star.pmra || 0, pmdec = star.pmdec || 0;
  const dt = (mjd - epochYearToMjd(star.epoch)) / DAYS_PER_YEAR; // years
  const a = star.ra * D2R, d = star.dec * D2R;
  const p = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const east = [-Math.sin(a), Math.cos(a), 0];
  const north = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  const ve = pmra * MAS2RAD * dt, vn = pmdec * MAS2RAD * dt;
  const r = [0, 1, 2].map(i => p[i] + ve * east[i] + vn * north[i]);
  const n = Math.hypot(...r);
  const dec = Math.asin(r[2] / n) * R2D;
  let ra = Math.atan2(r[1], r[0]) * R2D;
  if (ra < 0) ra += 360;
  return { ra, dec };
}

// Earth's barycentric position (AU, equatorial J2000) at an MJD: low-precision solar
// coordinates (Astronomical Almanac, ~0.01 deg; Earth = minus the Sun's geocentric vector).
// Good to ~0.5% of the parallax, i.e. <3 mas for Barnard's Star. SPHEREx is in low Earth
// orbit (the X_SC/Y_SC/Z_SC header keys are geocentric, ~7000 km = 5e-5 AU), so its own
// offset from Earth's centre changes a parallax by <0.03 mas and is ignored.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
export function earthBarycentric(mjd) {
  const n = mjd + 2400000.5 - 2451545.0;
  const L = (280.460 + 0.9856474 * n) * D2R, g = (357.528 + 0.9856003 * n) * D2R;
  const lam = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const R = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
  const eps = (23.439 - 0.0000004 * n) * D2R;
  return [-R * Math.cos(lam), -R * Math.sin(lam) * Math.cos(eps), -R * Math.sin(lam) * Math.sin(eps)];
}

// Annual parallax displacement [east, north] in arcsec of a star with parallax plxMas (mas)
// seen on date mjd: the star appears shifted away from Earth's position, by plx × the part
// of Earth's barycentric vector perpendicular to the line of sight.
export function parallaxShift(ra, dec, plxMas, mjd) {
  if (!(plxMas > 0)) return [0, 0];
  const [X, Y, Z] = earthBarycentric(mjd), a = ra * D2R, d = dec * D2R, p = plxMas / 1000;
  return [p * (X * Math.sin(a) - Y * Math.cos(a)), p * (X * Math.cos(a) * Math.sin(d) + Y * Math.sin(a) * Math.sin(d) - Z * Math.cos(d))];
}

// Angular separation in arcsec (Vincenty formula, stable for tiny angles).
export function separationArcsec(ra1, dec1, ra2, dec2) {
  const a1 = ra1 * D2R, d1 = dec1 * D2R, a2 = ra2 * D2R, d2 = dec2 * D2R;
  const da = a2 - a1;
  const num = Math.hypot(Math.cos(d2) * Math.sin(da),
    Math.cos(d1) * Math.sin(d2) - Math.sin(d1) * Math.cos(d2) * Math.cos(da));
  const den = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(da);
  return Math.atan2(num, den) * R2D * 3600;
}

// "08h55m10.831s" / "08 55 10.831" / "133.795" -> degrees. Dec likewise ("-7d14m42.53s").
export function parseAngle(text, isRA) {
  const s = String(text).trim().replace(/^[−‒–—﹣－]/, '-'); // Unicode minus/dashes -> '-'
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Number(s);
  const sign = /^\s*-/.test(s) ? -1 : 1;
  const parts = s.replace(/^[+-]/, '').split(/[hdms:°'"′″\s]+/).filter(Boolean).map(Number);
  if (parts.some(Number.isNaN) || parts.length === 0) throw new Error('Cannot read angle: ' + text);
  const [a, b = 0, c = 0] = parts;
  const v = a + b / 60 + c / 3600;
  return sign * (isRA ? v * 15 : v);
}
