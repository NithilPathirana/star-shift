// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// "How we know" (DESIGN.md 32): the verdict rules, shared by tools/make_proof.mjs (which
// computes the numbers) and web/app/proof/main.js (which prints them). Pure, no DOM.

export const PIXEL_ARCSEC = 6.15;

// The rules as printed on the page. Keep the wording and the code below in step.
export const RULES = {
  motion: [
    ['AGREES', 'the measured motion is within 2 uncertainties (2σ) of the catalogue, and the uncertainty is no more than half the value.'],
    ['AT THE LIMIT', 'between 2σ and 3σ, or the uncertainty is larger than half the value.'],
    ['DIFFERS', 'more than 3σ from the catalogue. Shown as measured, with the likely reason.'],
    ['NOT MEASURABLE', 'the catalogue motion moves the star less than one 6.15″ pixel over the dates we have, or the fit could not run.'],
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

// Proper motion verdict. m = { ok, total, totalErr } (mas/yr), cat = catalogue total (mas/yr),
// spanYears = time covered by the measured images.
export function motionVerdict(m, cat, catErr, spanYears) {
  const shiftPx = Number.isFinite(cat) && spanYears > 0 ? (cat / 1000) * spanYears / PIXEL_ARCSEC : null;
  if (shiftPx != null && shiftPx < 1) return { verdict: 'NOT MEASURABLE', why: 'slow', shiftPx, sigma: null };
  if (!m?.ok) return { verdict: 'NOT MEASURABLE', why: 'fit', shiftPx, sigma: null };
  const sigma = sigmaApart(m.total, m.totalErr, cat, catErr);
  if (sigma == null) return { verdict: 'NOT MEASURABLE', why: 'fit', shiftPx, sigma: null };
  const loose = m.totalErr > m.total / 2;
  const verdict = sigma > 3 ? 'DIFFERS' : (sigma > 2 || loose) ? 'AT THE LIMIT' : 'AGREES';
  return { verdict, why: loose ? 'loose' : null, shiftPx, sigma };
}

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

export const VERDICT_CLASS = { 'AGREES': 'v-agree', 'AT THE LIMIT': 'v-limit', 'DIFFERS': 'v-differ', 'NOT MEASURABLE': 'v-none' };
