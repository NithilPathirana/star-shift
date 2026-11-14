// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Star kinematics for the Motion panel (DESIGN.md section 27). Pure maths, no DOM.
// Units: proper motion in mas/yr (pmra already includes cos δ, as in SIMBAD and Gaia),
// parallax in mas, velocities in km/s, angles in degrees.

export const K = 4.740470446; // km/s per (AU/yr): 1″/yr at 1 pc
export const SPHEREX_PIX_ARCSEC = 6.2; // SPHEREx pixel scale

const ok = (v) => typeof v === 'number' && Number.isFinite(v);

// Total proper motion, mas/yr.
export function totalPM(pmra, pmdec) {
  if (!ok(pmra) || !ok(pmdec) || (!pmra && !pmdec)) return null;
  return Math.hypot(pmra, pmdec);
}

// Uncertainty of the total proper motion (no correlation term).
export function totalPMErr(pmra, pmdec, ePmra, ePmdec) {
  const mu = totalPM(pmra, pmdec);
  if (mu == null || !ok(ePmra) || !ok(ePmdec)) return null;
  return Math.hypot(pmra * ePmra, pmdec * ePmdec) / mu;
}

// Position angle of the motion, degrees east of north, 0..360.
export function motionPA(pmra, pmdec) {
  if (totalPM(pmra, pmdec) == null) return null;
  return (Math.atan2(pmra, pmdec) * 180 / Math.PI + 360) % 360;
}

// Years for the star to move one SPHEREx pixel.
export function yearsPerPixel(totalMasYr, pixArcsec = SPHEREX_PIX_ARCSEC) {
  if (!(totalMasYr > 0)) return null;
  return pixArcsec / (totalMasYr / 1000);
}

// Distance from parallax: 1000/ϖ pc. Flags a weak parallax (ϖ/σϖ < 5), where 1/ϖ is biased.
export function distancePc(plxMas, plxErrMas) {
  if (!(plxMas > 0)) return null;
  const snr = ok(plxErrMas) && plxErrMas > 0 ? plxMas / plxErrMas : null;
  const pc = 1000 / plxMas;
  return { pc, ly: pc * 3.261563777, snr, weak: snr != null && snr < 5 };
}

// Tangential velocity vt = 4.74047 · μ / ϖ (μ and ϖ in the same angular unit).
export function tangentialVelocity(totalMasYr, plxMas) {
  if (!(plxMas > 0) || !ok(totalMasYr)) return null;
  return K * totalMasYr / plxMas;
}

export function tangentialVelocityErr(totalMasYr, totalErr, plxMas, plxErr) {
  const vt = tangentialVelocity(totalMasYr, plxMas);
  if (vt == null || !ok(totalErr) || !ok(plxErr) || !(totalMasYr > 0)) return null;
  return vt * Math.hypot(totalErr / totalMasYr, plxErr / plxMas);
}

// Total space velocity √(vt² + vr²).
export function spaceVelocity(vt, vr) {
  if (!ok(vt) || !ok(vr)) return null;
  return Math.hypot(vt, vr);
}

// ICRS (J2000) -> galactic rotation (Hipparcos / Johnson & Soderblom 1987 'T' matrix).
const T = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
];

// Galactic U, V, W (km/s) relative to the Sun, Johnson & Soderblom (1987).
// U towards the Galactic centre, V in the direction of rotation, W towards the north Galactic pole.
// No solar-motion correction (use toLSR for that).
export function galacticUVW({ ra, dec, pmra, pmdec, plx, rv }) {
  if (![ra, dec, pmra, pmdec, rv].every(ok) || !(plx > 0)) return null;
  const a = ra * Math.PI / 180, d = dec * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cd = Math.cos(d), sd = Math.sin(d);
  const A = [[ca * cd, -sa, -ca * sd], [sa * cd, ca, -sa * sd], [sd, 0, cd]];
  const v = [rv, K * pmra / plx, K * pmdec / plx];
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let b = 0; for (let k = 0; k < 3; k++) b += T[i][k] * A[k][j];
    out[i] += b * v[j];
  }
  return { U: out[0], V: out[1], W: out[2] };
}

// Solar motion relative to the local standard of rest, Schönrich, Binney & Dehnen (2010).
export const SUN_LSR = { U: 11.1, V: 12.24, W: 7.25 };
export function toLSR(uvw) {
  if (!uvw) return null;
  return { U: uvw.U + SUN_LSR.U, V: uvw.V + SUN_LSR.V, W: uvw.W + SUN_LSR.W };
}

// Everything the Motion panel needs, from one catalogue record. Missing inputs -> null fields.
// rec: { ra, dec, pmra, pmdec, pmraErr?, pmdecErr?, plx?, plxErr?, rv?, rvErr? }
export function kinematics(rec) {
  if (!rec) return null;
  const { ra, dec, pmra, pmdec, pmraErr, pmdecErr, plx, plxErr, rv } = rec;
  const mu = totalPM(pmra, pmdec);
  const muErr = totalPMErr(pmra, pmdec, pmraErr, pmdecErr);
  const dist = distancePc(plx, plxErr);
  const vt = mu != null ? tangentialVelocity(mu, plx) : null;
  const vtErr = vt != null ? tangentialVelocityErr(mu, muErr, plx, plxErr) : null;
  const vr = ok(rv) ? rv : null;
  return {
    mu, muErr, pa: motionPA(pmra, pmdec), arcsecYr: mu != null ? mu / 1000 : null,
    yrPerPix: mu != null ? yearsPerPixel(mu) : null,
    dist, vt, vtErr, vr, vtot: spaceVelocity(vt, vr),
    uvw: mu != null ? galacticUVW({ ra, dec, pmra, pmdec, plx, rv }) : null,
  };
}
