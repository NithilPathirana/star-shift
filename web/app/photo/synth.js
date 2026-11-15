// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// A synthetic night-sky "photo" drawn from the Hipparcos catalogue at a known centre, rotation and scale.
// Used by the tests (tests/photo.test.mjs) and to make the page's test image (tools/make_photo_fixture.mjs).
import { pixToSky, starsInPhoto } from './solve.js';

const D2R = Math.PI / 180;

// The exact solution for a centre (deg), "up" position angle (deg east of north) and scale (deg/px).
export function makeSolution({ ra, dec, up = 0, scale, w, h, m = 1 }) {
  const s = scale * D2R;
  return { ra0: ra, dec0: dec, a: -s * Math.cos(up * D2R) * m, b: s * Math.sin(up * D2R) * m, tx: 0, ty: 0, m, cx: w / 2, cy: h / 2 };
}

// Small seeded random numbers (mulberry32) so the image is the same every time.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Render: Float32Array luminance 0..255 (saturating), stars to magLimit as Gaussians.
// Real-camera extras: k1 = barrel (<0) lens distortion at the corners, vig = vignetting, scatter = random
// brightness error (mag, as from star colours), grad = sky glow towards the bottom, ground = lit foreground fraction.
export function renderField(cat, opts) {
  const { w, h, magLimit = 5.5, sigma = 1.3, bg = 14, noise = 2, seed = 7, m0 = 5.0, peak0 = 40, drop = 0, extra = 0, k1 = 0, vig = 0, scatter = 0, grad = 0, ground = 0 } = opts;
  const sol = makeSolution(opts), img = new Float32Array(w * h), rnd = rng(seed), R2 = (w * w + h * h) / 4;
  for (let y = 0; y < h; y++) img.fill(bg + grad * y / h, y * w, (y + 1) * w);
  const stamp = (x, y, amp) => {
    const R = Math.ceil(4 * sigma);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      img[Y * w + X] += amp * Math.exp(-((X - x) ** 2 + (Y - y) ** 2) / (2 * sigma * sigma));
    }
  };
  const shown = starsInPhoto(cat, sol, w, h, magLimit, 5000);
  for (const s of shown) {
    if (drop && rnd() < drop) continue;
    const dx = s.x - w / 2, dy = s.y - h / 2, r2 = (dx * dx + dy * dy) / R2, f = 1 + k1 * r2;
    stamp(w / 2 + dx * f, h / 2 + dy * f, peak0 * 10 ** (-0.4 * (s.mag + (scatter ? scatter * (2 * rnd() - 1) : 0) - m0)) * (1 - vig * r2));
  }
  for (let k = 0; k < extra; k++) stamp(rnd() * w, rnd() * h, peak0 * (0.5 + 3 * rnd())); // stray lights / satellites
  for (let y = Math.floor(h * (1 - ground)); y < h; y++) for (let x = 0; x < w; x++) img[y * w + x] = bg + 15 + 25 * rnd() * Math.abs(Math.sin(x / 40)) + ((x * 7 + y * 3) % 97 === 0 ? 180 : 0); // trees, windows
  for (let i = 0; i < img.length; i++) {
    const g = Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
    img[i] = Math.max(0, Math.min(255, img[i] + noise * g));
  }
  return { img, sol, shown, centre: pixToSky(sol, w / 2, h / 2) };
}
