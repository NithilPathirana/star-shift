// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Telescope compare (DESIGN.md 31a), pure maths: one shared sky field for the three panels,
// north up and east left, at one angular scale; each survey image keeps its own pixels and is
// drawn with an affine map from its own WCS (no resampling). Also the survey header readers.
// No DOM here: used by the page and by tests/telescopes.test.mjs.
import { tanProject, tanDeproject } from '../../core/wcs.js';
import { propagate, epochYearToMjd, mjdToEpochYear } from '../../core/motion.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// FITS celestial WCS for the survey images: TAN or SIN (2MASS and AllWISE atlases are SIN),
// with CD, PC+CDELT, or CDELT+CROTA2. Pixels are 0-based (first pixel centre = 0).
export function linearWcs(h) {
  const t1 = String(h.CTYPE1 || ''), t2 = String(h.CTYPE2 || '');
  const proj = /-(TAN|SIN)$/.exec(t1)?.[1];
  if (!proj || !/^RA--/.test(t1) || !/^DEC-/.test(t2) || !/-(TAN|SIN)$/.test(t2)) throw new Error('Unsupported WCS: ' + t1 + ' / ' + t2);
  let cd;
  if (h.CD1_1 != null) cd = [[h.CD1_1, h.CD1_2 ?? 0], [h.CD2_1 ?? 0, h.CD2_2]];
  else {
    const c1 = h.CDELT1, c2 = h.CDELT2;
    if (!Number.isFinite(c1) || !Number.isFinite(c2)) throw new Error('No pixel scale in the header');
    if (h.PC1_1 != null) cd = [[h.PC1_1 * c1, (h.PC1_2 ?? 0) * c1], [(h.PC2_1 ?? 0) * c2, (h.PC2_2 ?? 1) * c2]];
    else { // AIPS convention: CROTA2 = twist of +axis 2 west of north
      const r = (h.CROTA2 ?? 0) * D2R, c = Math.cos(r), s = Math.sin(r);
      cd = [[c1 * c, -c2 * s], [c1 * s, c2 * c]];
    }
  }
  const crpix = [h.CRPIX1, h.CRPIX2], crval = [h.CRVAL1, h.CRVAL2];
  const scaleArcsec = Math.sqrt(Math.abs(cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0])) * 3600;
  function pixToWorld(x, y) {
    const u = x + 1 - crpix[0], v = y + 1 - crpix[1];
    const xi = cd[0][0] * u + cd[0][1] * v, eta = cd[1][0] * u + cd[1][1] * v; // degrees on the plane
    if (proj === 'TAN') return tanDeproject(xi, eta, crval[0], crval[1]);
    return sinDeproject(xi, eta, crval[0], crval[1]);
  }
  return { proj, cd, crpix, crval, scaleArcsec, pixToWorld };
}

// Orthographic (SIN) deprojection, degrees in and out.
export function sinDeproject(xiDeg, etaDeg, ra0, dec0) {
  const x = xiDeg * D2R, y = etaDeg * D2R, a0 = ra0 * D2R, d0 = dec0 * D2R;
  const r2 = x * x + y * y; if (r2 > 1) return [NaN, NaN];
  const z = Math.sqrt(1 - r2);
  const dec = Math.asin(y * Math.cos(d0) + z * Math.sin(d0));
  const ra = a0 + Math.atan2(x, z * Math.cos(d0) - y * Math.sin(d0));
  return [((ra * R2D) % 360 + 360) % 360, dec * R2D];
}

// One shared square field (arcsec) that holds every given position with a margin.
// Positions: [{ra, dec}]. Centre: middle of their extent on the tangent plane.
export function fieldFor(positions, { minArcsec = 150, marginArcsec = 50, maxArcsec = 900 } = {}) {
  const ok = positions.filter(p => p && Number.isFinite(p.ra) && Number.isFinite(p.dec));
  if (!ok.length) throw new Error('No positions');
  const r0 = ok[0], pts = ok.map(p => tanProject(p.ra, p.dec, r0.ra, r0.dec).map(v => v * 3600));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const [ra0, dec0] = tanDeproject(cx / 3600, cy / 3600, r0.ra, r0.dec);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const want = extent + 2 * marginArcsec;
  const size = Math.min(maxArcsec, Math.max(minArcsec, Math.ceil(want / 10) * 10));
  return { ra0, dec0, sizeArcsec: size, clipped: want > maxArcsec };
}

// Sky -> panel CSS pixels. North up, east LEFT (as on the sky), same scale for every panel.
export function skyToScreen(field, side, ra, dec) {
  const [xi, eta] = tanProject(ra, dec, field.ra0, field.dec0);
  const k = side / field.sizeArcsec; // CSS px per arcsec
  return [side / 2 - xi * 3600 * k, side / 2 - eta * 3600 * k];
}
export const pxPerArcsec = (field, side) => side / field.sizeArcsec;
// How big one of the survey's own pixels is on screen (CSS px).
export const screenPixel = (field, side, pixArcsec) => pixArcsec * pxPerArcsec(field, side);

// Affine [a, b, c, d, e, f] (canvas setTransform order) taking an nx×ny offscreen image to the
// panel. Image canvas pixel (U, V) covers [U, U+1]×[V, V+1]; its centre is source pixel
// (x = U, y = flipY ? ny-1-V : V). Linearised at the source pixel nearest the field centre,
// which is exact for TAN/SIN over a few arcminutes (error far below one pixel).
export function imageAffine(pixToWorld, nx, ny, field, side, { flipY = true, near = null } = {}) {
  const S = (x, y) => { const [ra, dec] = pixToWorld(x, y); return skyToScreen(field, side, ra, dec); };
  const [x0, y0] = near || [Math.round((nx - 1) / 2), Math.round((ny - 1) / 2)];
  const s0 = S(x0, y0), sx = S(x0 + 1, y0), sy = S(x0, y0 + 1);
  const Sx = [sx[0] - s0[0], sx[1] - s0[1]], Sy = [sy[0] - s0[0], sy[1] - s0[1]];
  if (flipY) {
    // screen = s0 + (U - 0.5 - x0)·Sx + (ny - 0.5 - V - y0)·Sy
    return [Sx[0], Sx[1], -Sy[0], -Sy[1],
      s0[0] + (-0.5 - x0) * Sx[0] + (ny - 0.5 - y0) * Sy[0], s0[1] + (-0.5 - x0) * Sx[1] + (ny - 0.5 - y0) * Sy[1]];
  }
  // screen = s0 + (U - 0.5 - x0)·Sx + (V - 0.5 - y0)·Sy
  return [Sx[0], Sx[1], Sy[0], Sy[1],
    s0[0] + (-0.5 - x0) * Sx[0] + (-0.5 - y0) * Sy[0], s0[1] + (-0.5 - x0) * Sx[1] + (-0.5 - y0) * Sy[1]];
}
export const applyAffine = (m, u, v) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]];

// Source pixel nearest a sky position (for linearising near the field centre).
export function nearestPixel(wcs, ra, dec, nx, ny) {
  let best = [0, 0], bd = Infinity; // coarse search then refine: tiny images, so cheap enough
  const step = Math.max(1, Math.floor(Math.min(nx, ny) / 16));
  const d = (x, y) => { const [r, de] = wcs.pixToWorld(x, y); const [a, b] = tanProject(r, de, ra, dec); return a * a + b * b; };
  for (let y = 0; y < ny; y += step) for (let x = 0; x < nx; x += step) { const v = d(x, y); if (v < bd) { bd = v; best = [x, y]; } }
  for (let y = Math.max(0, best[1] - step); y <= Math.min(ny - 1, best[1] + step); y++)
    for (let x = Math.max(0, best[0] - step); x <= Math.min(nx - 1, best[0] + step); x++) { const v = d(x, y); if (v < bd) { bd = v; best = [x, y]; } }
  return best;
}

/* ---------- survey metadata from the image headers ---------- */
const yymmdd = (s) => { const m = /^(\d\d)(\d\d)(\d\d)/.exec(String(s || '').trim()); if (!m) return null; const y = +m[1]; return `${y < 50 ? 2000 + y : 1900 + y}-${m[2]}-${m[3]}`; };
const isoToMjd = (iso) => { const t = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z'); return Number.isFinite(t) ? t / 86400000 + 40587 : null; };

// 2MASS atlas image: real UT date and time of the frame, and the telescope.
export function twomassMeta(h) {
  const date = yymmdd(h.UT_DATE) || yymmdd(h.ORDATE);
  const ut = /^\d\d:\d\d:\d\d(\.\d+)?$/.test(String(h.UT || '').trim()) ? String(h.UT).trim() : '00:00:00';
  const iso = date ? `${date}T${ut}` : null;
  const tel = String(h.TELNAME || '').trim();
  const site = /hopkins/i.test(tel) ? 'Mt Hopkins, Arizona' : /ctio|tololo/i.test(tel) ? 'Cerro Tololo, Chile' : (tel || null);
  const hemi = /hopkins/i.test(tel) ? 'north' : /ctio|tololo/i.test(tel) ? 'south' : null;
  return { date, iso, mjd: iso ? isoToMjd(iso) : null, site, hemi, band: String(h.FILTER || '').trim().toLowerCase() };
}

// AllWISE atlas coadd: first, last and middle frame dates (it stacks many frames).
export function wiseMeta(h) {
  const d1 = h.DATEOBS1 ? String(h.DATEOBS1).trim() : null, d2 = h.DATEOBS2 ? String(h.DATEOBS2).trim() : null;
  const mid = h.MIDOBS ? String(h.MIDOBS).trim() : null;
  return { first: d1?.slice(0, 10) ?? null, last: d2?.slice(0, 10) ?? null, mid: mid?.slice(0, 10) ?? null,
    mjd: mid ? isoToMjd(mid) : null, frames: Number.isFinite(h.NUMFRMS) ? h.NUMFRMS : null,
    band: Number.isFinite(h.BAND) ? `W${h.BAND}` : null, um: Number.isFinite(h.WAVELEN) ? h.WAVELEN : null };
}

// Nominal survey epochs (used only to size the field before any header has arrived).
export const NOMINAL = { twomass: epochYearToMjd(1999.0), wise: epochYearToMjd(2010.5) };

// Positions of a moving star at each epoch; null star = not moving (one fixed point).
export function positionsAt(star, fixed, mjds) {
  return mjds.map(m => (star && Number.isFinite(m) ? propagate(star, m) : { ...fixed }));
}
export const yearOf = (mjd) => Math.floor(mjdToEpochYear(mjd));

// Robust asinh stretch to 0..255 from the 2nd and 99.7th percentiles (nulls/NaN skipped).
export function stretch(values) {
  const v = []; for (const x of values) if (x != null && Number.isFinite(x)) v.push(x);
  if (!v.length) return { lo: 0, hi: 1, map: () => 0 };
  v.sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  const lo = q(0.02), hi = Math.max(q(0.997), lo + 1e-9), a = 10;
  const norm = Math.asinh(a);
  return { lo, hi, map: (x) => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return Math.round(255 * Math.asinh(a * t) / norm); } };
}
