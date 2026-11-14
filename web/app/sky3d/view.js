// View maths for the 3D sky (pure, no DOM, no three.js): directions, the camera frame,
// gnomonic (perspective) projection from inside the sphere, tile level choice, visible
// tiles, star colour/size and star picking.
// Screen convention: north up, east LEFT (the sky seen from inside).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { pixToVec, vecToPix, npix, children, tileRadius } from './healpix.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const MIN_FOV = 0.02, MAX_FOV = 100; // degrees across the width (programmatic range)
export const GESTURE_MIN_FOV = 0.5; // wheel/pinch stop here (DESIGN.md section 18)
export const PITCH_LIMIT = 89.5;

export function radecToVec(ra, dec) {
  const a = ra * D2R, d = dec * D2R, c = Math.cos(d);
  return [c * Math.cos(a), c * Math.sin(a), Math.sin(d)];
}
export function vecToRadec(v) {
  const r = Math.hypot(v[0], v[1], v[2]);
  let ra = Math.atan2(v[1], v[0]) * R2D; if (ra < 0) ra += 360; if (ra >= 360) ra -= 360;
  return [ra, Math.asin(Math.max(-1, Math.min(1, v[2] / r))) * R2D];
}
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const wrap360 = (a) => ((a % 360) + 360) % 360;
export const wrap180 = (a) => { const w = wrap360(a + 180) - 180; return w === -180 ? 180 : w; };
export const clampDec = (d) => Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, d));
export const clampFov = (f) => Math.max(MIN_FOV, Math.min(MAX_FOV, f));

// Camera frame looking at (ra, dec) with north up: right = west (east is left), up = north.
export function frame(ra, dec) {
  const a = ra * D2R, d = dec * D2R;
  const f = radecToVec(ra, dec);
  const e = [-Math.sin(a), Math.cos(a), 0];
  const n = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  return { f, right: [-e[0], -e[1], -e[2]], up: n };
}

// Stereographic projection from the centre of the sphere (conformal, like Stellarium): shapes
// stay true at wide fields and on tall phone screens, where a perspective camera stretches the
// edges. view = { ra, dec, fov (deg across the width), w, h (CSS px) }.
const halfR = (fov) => 2 * Math.tan((fov * D2R) / 4); // projected radius of the half-width angle
export const BEHIND = -0.2; // cos of the angle from the centre beyond which a point counts as behind
export function project(view, v, fr = frame(view.ra, view.dec)) {
  const z = dot(v, fr.f);
  if (z <= BEHIND) return null;
  const k = 2 / (1 + z), s = (view.w / 2) / halfR(view.fov);
  return [view.w / 2 + dot(v, fr.right) * k * s, view.h / 2 - dot(v, fr.up) * k * s];
}
export function unproject(view, x, y, fr = frame(view.ra, view.dec)) {
  const s = (view.w / 2) / halfR(view.fov);
  const X = (x - view.w / 2) / s, Y = -(y - view.h / 2) / s, r2 = X * X + Y * Y, q = 4 / (4 + r2), cz = (4 - r2) / (4 + r2);
  const cx = X * q, cy = Y * q;
  return [cz * fr.f[0] + cx * fr.right[0] + cy * fr.up[0], cz * fr.f[1] + cx * fr.right[1] + cy * fr.up[1], cz * fr.f[2] + cx * fr.right[2] + cy * fr.up[2]];
}
// Shader scale: clip-space x, y = (camera x, y) * 2 / (1 + z) * clipScale.
export function clipScale(view) { const t = halfR(view.fov); return [1 / t, (view.w / Math.max(1, view.h)) / t]; }
// Angle (deg) across the height for a FOV across the width.
export function vfov(fovW, w, h) { return 4 * Math.atan(Math.tan((fovW * D2R) / 4) * (h / Math.max(1, w))) * R2D; }
// Angle (rad) from the view centre to the farthest screen corner.
export function viewRadius(view) { return 2 * Math.atan(Math.tan((view.fov * D2R) / 4) * Math.hypot(1, view.h / Math.max(1, view.w))); }
export const pxPerDeg = (view) => view.w / view.fov;

// Tile level: the coarsest HiPS order whose 512-px tiles are at least as sharp as the screen.
// Returns 0 when the 64-px Allsky thumbnails are enough.
// Tiles are only used below DETAIL_START (the detail layer fades in from there).
export const DETAIL_START = 20, DETAIL_FULL = 8;
export function chooseOrder(view, dpr = 1, { tile = 512, maxOrder = 5, minOrder = 3 } = {}) {
  if (view.fov >= DETAIL_START) return 0;
  const need = pxPerDeg(view) * Math.min(2, dpr) * 0.75; // a little under 1:1 still looks sharp
  const sharp = (o, px) => (px * 2 ** o) / 58.6;
  for (let o = minOrder; o <= maxOrder; o++) if (sharp(o, tile) >= need) return o;
  return maxOrder;
}

// Tiles of `order` that may be on screen, centre tile first (load order).
export function visibleTiles(view, order, fr = frame(view.ra, view.dec)) {
  const lim = viewRadius(view);
  const out = [];
  const walk = (o, n) => {
    const c = pixToVec(o, n), ang = Math.acos(Math.max(-1, Math.min(1, dot(c, fr.f))));
    if (ang > lim + tileRadius(o)) return;
    if (o === order) { out.push([n, ang]); return; }
    for (const k of children(n)) walk(o + 1, k);
  };
  for (let n = 0; n < npix(0); n++) walk(0, n);
  return out.sort((a, b) => a[1] - b[1]).map(t => t[0]);
}
export { vecToPix };

// DESIGN.md section 18: the Milky Way (SPHEREx Allsky) shows at 40 %; the SPHEREx detail
// ramps 0 -> 1 between 20° and 8° FOV while the catalogue stars fade to 30 %.
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function detailRamp(fov) { return 1 - smooth(DETAIL_FULL, DETAIL_START, fov); }
export function imageryAlpha(fov) { return 0.4 + 0.6 * detailRamp(fov); }
export function starAlpha(fov) { return 1 - 0.7 * detailRamp(fov); }
// Faint stars fade in as the view narrows: magnitude limit 5.0 at 100° -> 6.9 at 15° and below.
export function magLimit(fov) { const t = Math.max(0, Math.min(1, Math.log(100 / Math.max(fov, 1e-6)) / Math.log(100 / 15))); return 5.0 + 1.9 * t; }

// B-V -> colour, warm-shifted (DESIGN.md section 18 table), linear between rows.
const BV_STOPS = [[-0.2, 0xB4C8FF], [0.0, 0xEEF0F2], [0.4, 0xFFF1DD], [0.8, 0xFFDDB0], [1.2, 0xFFC48C], [1.6, 0xFFA86E]];
const rgb = (h) => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
export function starColor(bv) {
  if (!Number.isFinite(bv)) bv = 0.6;
  if (bv <= BV_STOPS[0][0]) return rgb(BV_STOPS[0][1]);
  for (let i = 1; i < BV_STOPS.length; i++) {
    const [b1, c1] = BV_STOPS[i];
    if (bv <= b1) { const [b0, c0] = BV_STOPS[i - 1], t = (bv - b0) / (b1 - b0), p = rgb(c0), q = rgb(c1); return p.map((v, k) => v + (q[k] - v) * t); }
  }
  return rgb(BV_STOPS[BV_STOPS.length - 1][1]);
}
// Core diameter in CSS px (times min(devicePixelRatio, 2) when drawn) and alpha for a V magnitude.
export function starSize(V) { return Math.max(1.2, Math.min(7, 1.2 + (6.5 - V) * 0.85)); }
export function starBright(V) { return Math.max(0.25, Math.min(1, Math.pow(10 ** (-0.4 * V) / 10 ** (-0.4 * -1.5), 0.35))); }

// Star nearest the direction `v` within `maxRad`, preferring bright stars a little.
// stars: { x: Float32Array (xyz triplets), mag: Float32Array }.
export function pickStar(stars, v, maxRad, maxMag = Infinity) {
  const cosLim = Math.cos(maxRad);
  let best = -1, bestScore = Infinity;
  const { x, mag } = stars, n = mag.length;
  for (let i = 0; i < n; i++) {
    const c = x[3 * i] * v[0] + x[3 * i + 1] * v[1] + x[3 * i + 2] * v[2];
    if (c < cosLim || mag[i] > maxMag) continue;
    const ang = Math.acos(Math.min(1, c)) / maxRad; // 0..1
    const score = ang + 0.04 * mag[i];
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

// Nearest of a few objects (e.g. SIMBAD names) to direction v within maxRad: { i, ang } or null.
export function pickNearest(vecs, v, maxRad) {
  let best = null;
  for (let i = 0; i < vecs.length; i++) {
    const c = Math.min(1, dot(vecs[i], v));
    const ang = Math.acos(c);
    if (ang <= maxRad && (!best || ang < best.ang)) best = { i, ang };
  }
  return best;
}
// Cone radius (deg) and row limit for on-demand SIMBAD names, or null when the view is too wide.
export const NAMES_MAX_FOV = 1.5;
export function namesQuery(fov) { return fov > NAMES_MAX_FOV ? null : { radius: Math.min(1.1, fov * 0.75), limit: fov < 0.3 ? 60 : 80 }; }

// Great-circle interpolation of the view centre, t in [0, 1].
export function slerpRadec(a, b, t) {
  const va = radecToVec(a.ra, a.dec), vb = radecToVec(b.ra, b.dec);
  const c = Math.max(-1, Math.min(1, dot(va, vb))), om = Math.acos(c);
  if (om < 1e-9) return { ra: b.ra, dec: b.dec };
  const s = Math.sin(om), k1 = Math.sin((1 - t) * om) / s, k2 = Math.sin(t * om) / s;
  const [ra, dec] = vecToRadec([va[0] * k1 + vb[0] * k2, va[1] * k1 + vb[1] * k2, va[2] * k1 + vb[2] * k2]);
  return { ra, dec };
}
// cubic-bezier(.77, 0, .175, 1) (DESIGN.md section 18 camera slerp), solved for x by Newton steps.
export function easeInOut(x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bz = (t, p1, p2) => 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
  const dbz = (t, p1, p2) => 3 * (1 - t) * (1 - t) * p1 + 6 * (1 - t) * t * (p2 - p1) + 3 * t * t * (1 - p2);
  let t = x;
  for (let i = 0; i < 8; i++) { const d = dbz(t, 0.77, 0.175); if (Math.abs(d) < 1e-6) break; t -= (bz(t, 0.77, 0.175) - x) / d; t = Math.max(0, Math.min(1, t)); }
  return bz(t, 0, 1);
}

// Pan by fractions of the view (+x = east/left, +y = north), like SkyMap.panBy.
export function panned(view, fx, fy) {
  return { ra: wrap360(view.ra + (fx * view.fov) / Math.max(0.2, Math.cos(view.dec * D2R))), dec: clampDec(view.dec + fy * view.fov) };
}

// Grid spacing (deg) giving roughly 4-8 lines across the view.
export function gridStep(fov) {
  const steps = [30, 15, 10, 5, 2, 1, 0.5, 0.25, 1 / 6, 1 / 12, 1 / 30, 1 / 60, 1 / 120];
  for (const s of steps) if (fov / s >= 4) return s;
  return steps[steps.length - 1];
}
