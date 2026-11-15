// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Stereographic projection of the local sky (x = East, y = North, z = Up) onto the screen.
// Stereographic keeps shapes true, so constellations and the Moon look right at wide angles.
import { D2R } from './astro.js';

// view = { az, alt (deg, where the centre of the screen looks), fov (deg across the shorter
// side), w, h (CSS px), shift (optional px: the view centre sits this far above the canvas
// middle, e.g. when the phone details sheet covers the lower sky) }. Returns a projector.
export function makeView({ az, alt, fov, w, h, shift = 0 }) {
  const a = az * D2R, e = alt * D2R, ca = Math.cos(e);
  const d = [ca * Math.sin(a), ca * Math.cos(a), Math.sin(e)]; // forward
  const r = [Math.cos(a), -Math.sin(a), 0];                    // right (towards larger azimuth)
  const u = [r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]]; // up = r × d
  const scale = (Math.min(w, h) / 2) / (2 * Math.tan(fov * D2R / 4));
  return { az, alt, fov, w, h, shift, d, r, u, scale, cx: w / 2, cy: h / 2 - shift };
}

// Project one unit vector. Returns [x, y] in CSS px, or null when it is (nearly) behind
// the viewer. `out` is reused to avoid allocations in the star loop.
export function project(v, x, y, z, out = [0, 0]) {
  const Z = x * v.d[0] + y * v.d[1] + z * v.d[2];
  if (Z < -0.6) return null;
  const k = 2 / (1 + Z) * v.scale;
  out[0] = v.cx + k * (x * v.r[0] + y * v.r[1] + z * v.r[2]);
  out[1] = v.cy - k * (x * v.u[0] + y * v.u[1] + z * v.u[2]);
  return out;
}

// Screen point (CSS px) back to a unit vector in the local frame.
export function unproject(v, px, py) {
  const X = (px - v.cx) / v.scale, Y = -(py - v.cy) / v.scale, rho2 = X * X + Y * Y;
  const Z = (4 - rho2) / (4 + rho2), f = (1 + Z) / 2, Xs = X * f, Ys = Y * f;
  return [
    Xs * v.r[0] + Ys * v.u[0] + Z * v.d[0],
    Xs * v.r[1] + Ys * v.u[1] + Z * v.d[1],
    Xs * v.r[2] + Ys * v.u[2] + Z * v.d[2],
  ];
}

// Faintest magnitude worth drawing for a field of view (more stars as you zoom in).
export function magLimit(fov) {
  return Math.min(9, 6.5 + Math.max(0, Math.log2(90 / Math.max(fov, 1))) * 0.6);
}

// Zoom around a screen point: returns the new {az, alt} so the sky under (px,py) stays put.
export function zoomAbout(view, px, py, newFov) {
  const p = unproject(view, px, py);
  let best = { az: view.az, alt: view.alt };
  // Two fixed-point passes are enough: solve for the centre that maps p back to (px,py).
  for (let i = 0; i < 3; i++) {
    const v2 = makeView({ ...view, ...best, fov: newFov });
    const q = unproject(v2, px, py);
    const a0 = Math.atan2(p[0], p[1]), a1 = Math.atan2(q[0], q[1]);
    const e0 = Math.asin(Math.max(-1, Math.min(1, p[2]))), e1 = Math.asin(Math.max(-1, Math.min(1, q[2])));
    best = { az: best.az + (a0 - a1) / D2R, alt: Math.max(-30, Math.min(89.5, best.alt + (e0 - e1) / D2R)) };
  }
  return best;
}
