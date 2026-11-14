// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// The Ghost (team feature C, DESIGN.md section 24): where a star was or will be on another
// date, from its catalogue proper motion in a straight line (motion.js `propagate`).
// Parallax (the yearly wobble, < 0.55″ even for Barnard's Star) and any change in speed
// (perspective acceleration) are left out. Pure helpers only; no DOM.

import { propagate, separationArcsec } from './motion.js';

export const DAYS_PER_YEAR = 365.25;
export const PIXEL_ARCSEC = 6.15;

export const totalPm = s => Math.hypot(s?.pmra || 0, s?.pmdec || 0); // mas/yr
export const hasMotion = s => !!s && totalPm(s) > 0;

// Slider half-range (years): ±50, stepping to ±500 / ±5,000 when the star moves less than
// one SPHEREx pixel in that time (DESIGN.md 24). Step = 1/50 of the half-range.
export function ghostRange(star, pixelArcsec = PIXEL_ARCSEC) {
  const pm = totalPm(star) / 1000; // ″/yr
  for (const half of [50, 500, 5000]) if (pm * half >= pixelArcsec) return { half, step: half / 50 };
  return { half: 5000, step: 100 };
}

// Tick spacing on the trail: 1, 10, 100 or 1000 years, whichever gives 3 to 12 ticks.
export function tickStep(spanYears) {
  const s = Math.abs(spanYears);
  for (const st of [1, 10, 100, 1000]) if (s / st <= 12) return st;
  return 1000;
}

export const ghostMjd = (mjd0, years) => mjd0 + years * DAYS_PER_YEAR;
export function ghostPos(star, mjd0, years) { return propagate(star, ghostMjd(mjd0, years)); }

// Points along the path from mjd0 to mjd0 + years (n + 1 samples), and the tick dates.
export function ghostTrail(star, mjd0, years, n = 40) {
  const pts = [];
  for (let k = 0; k <= n; k++) pts.push(propagate(star, ghostMjd(mjd0, (years * k) / n)));
  const st = tickStep(years), ticks = [];
  if (years) for (let y = st; y < Math.abs(years) - 1e-9; y += st) ticks.push(propagate(star, ghostMjd(mjd0, Math.sign(years) * y)));
  return { pts, ticks, step: st };
}

// Sky offset of b from a: east and north components in arcsec (small-angle, tangent plane).
export function offsetEN(a, b) {
  const d2r = Math.PI / 180;
  let dra = b.ra - a.ra; if (dra > 180) dra -= 360; if (dra < -180) dra += 360;
  return { e: dra * Math.cos(((a.dec + b.dec) / 2) * d2r) * 3600, n: (b.dec - a.dec) * 3600 };
}
const C16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass16(e, n) {
  const ang = ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360; // 0 = north, 90 = east
  return C16[Math.round(ang / 22.5) % 16];
}
// 4′ 20″ · 12.3″ · 1° 02′
export function fmtArc(arcsec) {
  const a = Math.abs(arcsec);
  if (a < 60) return `${a.toFixed(a < 10 ? 1 : 0)}″`;
  if (a < 3600) { const m = Math.floor(a / 60), s = Math.round(a - m * 60); return s === 60 ? `${m + 1}′ 00″` : `${m}′ ${String(s).padStart(2, '0')}″`; }
  const d = Math.floor(a / 3600), m = Math.round((a - d * 3600) / 60); return `${d}° ${String(m).padStart(2, '0')}′`;
}
export function moved(star, mjd0, years) {
  const a = propagate(star, mjd0), b = ghostPos(star, mjd0, years), o = offsetEN(a, b);
  return { arcsec: separationArcsec(a.ra, a.dec, b.ra, b.dec), dir: compass16(o.e, o.n), e: o.e, n: o.n };
}
// "2051 · +25 yr"
export function ghostLabel(mjd0, years) {
  const yr = 2000 + (ghostMjd(mjd0, years) - 51544.5) / DAYS_PER_YEAR;
  const y = Math.round(years);
  return `${Math.floor(yr)} · ${y > 0 ? '+' : y < 0 ? '−' : '±'}${Math.abs(y).toLocaleString('en-US')} yr`;
}

// Choose the Gaia DR3 row for a star. rows: from gaiaCone (epoch 2016). want: { ra, dec }
// where the star should be in 2016. mode 'nearest' (a named star) or 'brightest' (a patch
// centre: the brightest source within the radius). Returns null when nothing is close.
export function pickGaia(rows, want, radiusArcsec, mode = 'nearest') {
  const near = (rows || []).map(r => ({ ...r, sep: separationArcsec(want.ra, want.dec, r.ra, r.dec) }))
    .filter(r => r.sep <= radiusArcsec && Number.isFinite(r.pmra) && Number.isFinite(r.pmdec) && (r.pmra || r.pmdec));
  if (!near.length) return null;
  near.sort(mode === 'brightest' ? (a, b) => (a.g ?? 99) - (b.g ?? 99) : (a, b) => a.sep - b.sep);
  return near[0];
}
