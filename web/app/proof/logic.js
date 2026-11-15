// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// "How we know" (DESIGN.md 32): the verdict rules, shared by tools/make_proof.mjs (which
// computes the numbers) and web/app/proof/main.js (which prints them). Pure, no DOM.

import { motionMeasurability } from '../data.js';

export const PIXEL_ARCSEC = 6.15;

// The rules as printed on the page. Keep the wording and the code below in step.
export const RULES = {
  motion: [
    ['AGREES', 'the measured speed is within 2 uncertainties (2σ) of the catalogue, and the uncertainty is no more than half the value.'],
    ['AT THE LIMIT', 'between 2σ and 3σ, or the uncertainty is larger than half the value.'],
    ['DIFFERS', 'more than 3σ from the catalogue. Shown as measured, with the likely reason.'],
    ['NOT MEASURABLE', 'the catalogue motion is below 0.7″ a year (the smallest motion we call real, at least 3 × the 0.15″/yr floor), so it cannot show in these images, the star\'s centre is blanked (masked pixels within 2 pixels of it) in 90% or more of the fitted images (the 90% limit), or the fit could not run. A saturation flag alone does not count; only a blanked centre does.'],
  ],
  // Direction, judged on its own chip beside the speed verdict.
  direction: [
    ['DIRECTION AGREES', 'measured and catalogue motions, compared as arrows (east and north parts together), are within 2σ. The two-part difference √((Δe/σe)² + (Δn/σn)²) is turned into the one-part σ with the same chance of happening by accident (2 degrees of freedom), so 2σ here means about 2.49 before the conversion and 3σ about 3.44.'],
    ['DIRECTION AT THE LIMIT', 'between 2σ and 3σ after that conversion.'],
    ['DIRECTION OFF', 'more than 3σ: the arrow points measurably away from the catalogue\'s, even if the speed agrees. Shown with the likely reason.'],
  ],
  brightness: [
    ['AGREES', 'the catalogue calls it a variable star, and we see its brightness change by more than 3σ between the first and last season, in at least one of the two wavelength groups.'],
    ['AT THE LIMIT', 'the change is under 3σ: no clear change above the noise.'],
    ['NOT MEASURABLE', 'too few images where the star\'s centre is unmasked and the wavelengths match.'],
  ],
};

// How many uncertainties apart two values are (catalogue error added in quadrature).
export function sigmaApart(measured, err, expected, expectedErr = 0) {
  const s = Math.hypot(err, expectedErr || 0);
  if (!Number.isFinite(measured) || !Number.isFinite(expected) || !(s > 0)) return null;
  return Math.abs(measured - expected) / s;
}

// Proper motion verdict (on the speed). m = { ok, total, totalErr } (mas/yr), cat = catalogue
// total (mas/yr), spanYears = time covered by the measured images.
// Measurability (slow / fit / saturated core) is data.js motionMeasurability(), the same rule
// the viewer uses (AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026).
// catVec = catalogue { pmra, pmdec } (mas/yr): when it and the fit's pmra/pmdec/pmraErr/pmdecErr
// are known, the direction is judged too (directionVerdict), on its own.
// Returns { verdict, why, shiftPx, sigma (speed), direction, window }.
export function motionVerdict(m, cat, catErr, spanYears, catVec = null) {
  const r = motionMeasurability(m, { catalogueMasYr: cat, spanYears });
  const shiftPx = r.shiftPx;
  if (!r.measurable) return { verdict: 'NOT MEASURABLE', why: r.why, shiftPx, sigma: null, direction: null };
  const sigma = sigmaApart(m.total, m.totalErr, cat, catErr);
  if (sigma == null) return { verdict: 'NOT MEASURABLE', why: 'fit', shiftPx, sigma: null, direction: null };
  const loose = m.totalErr > m.total / 2;
  const verdict = sigma > 3 ? 'DIFFERS' : (sigma > 2 || loose) ? 'AT THE LIMIT' : 'AGREES';
  return { verdict, why: loose ? 'loose' : null, shiftPx, sigma, direction: directionVerdict(m, catVec, catErr), window: agreeWindow(m, cat, catErr, catVec) };
}

// erfc(x), x ≥ 0 (Numerical Recipes erfcc, fractional error < 1.2e-7).
function erfc(x) {
  const t = 1 / (1 + 0.5 * x);
  return t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807
    + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
}
// The one-dimensional Gaussian σ with the same two-sided tail probability p.
export function sigmaFromP(p) {
  if (!(p > 0)) return Infinity;
  if (p >= 1) return 0;
  let lo = 0, hi = 40;
  for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (erfc(mid / Math.SQRT2) > p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
// χ = √((Δe/σe)² + (Δn/σn)²) has 2 degrees of freedom: P(> χ) = exp(−χ²/2). Equivalent 1-D σ.
export const sigma2dTo1d = (chi) => sigmaFromP(Math.exp(-chi * chi / 2));
// χ (2 degrees of freedom) that has the same probability as k σ in one dimension.
export const chi2dFor = (k) => Math.sqrt(-2 * Math.log(erfc(k / Math.SQRT2)));

// Measured minus catalogue motion as an arrow (mas/yr, east and north), χ over 2 degrees of
// freedom, and the equivalent 1-D sigma; each σ = fit error and catalogue error in quadrature.
export function vectorDiff(m, catVec, catErr = 0) {
  if (!catVec || ![m?.pmra, m?.pmdec, m?.pmraErr, m?.pmdecErr, catVec.pmra, catVec.pmdec].every(Number.isFinite)) return null;
  const de = m.pmra - catVec.pmra, dn = m.pmdec - catVec.pmdec;
  const se = Math.hypot(m.pmraErr, catErr || 0), sn = Math.hypot(m.pmdecErr, catErr || 0);
  if (!(se > 0 && sn > 0)) return null;
  const chi = Math.hypot(de / se, dn / sn);
  // sideways part: across the catalogue direction (unit (sin pa, cos pa) -> perpendicular (cos pa, −sin pa))
  const pa = Math.atan2(catVec.pmra, catVec.pmdec), side = de * Math.cos(pa) - dn * Math.sin(pa);
  return { e: de, n: dn, mag: Math.hypot(de, dn), side, chi, sigma: sigma2dTo1d(chi) };
}

// Direction verdict: { verdict, sigma (1-D equivalent), chi, ... vectorDiff } or null.
export function directionVerdict(m, catVec, catErr = 0) {
  const v = vectorDiff(m, catVec, catErr);
  if (!v) return null;
  return { ...v, verdict: v.sigma > 3 ? 'DIRECTION OFF' : v.sigma > 2 ? 'DIRECTION AT THE LIMIT' : 'DIRECTION AGREES' };
}

// The agreement window the rules allow: a measured speed from lo to hi (mas/yr) agrees, and
// (when the per-axis errors are known) a direction from paLo to paHi degrees agrees, each with
// the other part matching the catalogue.
export function agreeWindow(m, cat, catErr = 0, catVec = null) {
  if (!Number.isFinite(cat) || !Number.isFinite(m?.totalErr)) return null;
  const s = Math.hypot(m.totalErr, catErr || 0);
  const out = { lo: Math.max(0, cat - 2 * s), hi: cat + 2 * s };
  if (catVec && Number.isFinite(m.pmraErr) && Number.isFinite(m.pmdecErr) && cat > 0) {
    const pa = Math.atan2(catVec.pmra, catVec.pmdec); // east of north
    // error across the motion: per-axis errors projected on the perpendicular (cos pa, −sin pa)
    const perp = Math.hypot(Math.cos(pa) * Math.hypot(m.pmraErr, catErr || 0), Math.sin(pa) * Math.hypot(m.pmdecErr, catErr || 0));
    const half = Math.asin(Math.min(1, chi2dFor(2) * perp / cat)) * 180 / Math.PI, paDeg = (pa * 180 / Math.PI + 360) % 360;
    Object.assign(out, { paLo: (paDeg - half + 360) % 360, paHi: (paDeg + half) % 360, paHalf: half });
  }
  return out;
}

// Smallest angle between two position angles (degrees), signed measured − catalogue.
export const paDelta = (a, b) => ((a - b + 540) % 360) - 180;

// Brightness verdict. b = { ok, dmag, dmagErr }, variable = the catalogue lists it as a variable.
export function brightnessVerdict(b, variable) {
  if (!b?.ok || !(b.dmagErr > 0)) return { verdict: 'NOT MEASURABLE', sigma: null };
  const sigma = Math.abs(b.dmag) / b.dmagErr;
  return { verdict: variable && sigma > 3 ? 'AGREES' : 'AT THE LIMIT', sigma };
}

// Mean and standard error of the mean.
export function meanSem(a) {
  const v = a.filter(Number.isFinite);
  if (!v.length) return { mean: null, sem: null, n: 0 };
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sem = v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1) / v.length) : null;
  return { mean, sem, n: v.length };
}

// Projection of an east/north offset onto a position angle (degrees east of north).
export const along = (e, n, paDeg) => e * Math.sin(paDeg * Math.PI / 180) + n * Math.cos(paDeg * Math.PI / 180);

export const VERDICT_CLASS = { 'AGREES': 'v-agree', 'AT THE LIMIT': 'v-limit', 'DIFFERS': 'v-differ', 'NOT MEASURABLE': 'v-none',
  'DIRECTION AGREES': 'v-agree', 'DIRECTION AT THE LIMIT': 'v-limit', 'DIRECTION OFF': 'v-differ' };
