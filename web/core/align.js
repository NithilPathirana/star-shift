// Put every cutout on one common sky grid so frames line up (stars stay still,
// moving objects move), and measure where a star sits in a frame.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Grid convention: north up, east left (as on the sky). Arrays are row-major with
// row 0 at the TOP (ready for a canvas). Pixel (i, j) centre has standard
// coordinates xi = (cx - i) * scale, eta = (cy - j) * scale around (ra0, dec0).

import { tanProject, tanDeproject } from './wcs.js';

export function makeGrid(ra0, dec0, sizeArcsec, scaleArcsec = 6.15) {
  const n = Math.max(3, Math.round(sizeArcsec / scaleArcsec) | 1); // odd -> a centre pixel
  return { ra0, dec0, n, scale: scaleArcsec, c: (n - 1) / 2 };
}

export function gridToWorld(grid, i, j) {
  const xi = ((grid.c - i) * grid.scale) / 3600;
  const eta = ((grid.c - j) * grid.scale) / 3600;
  return tanDeproject(xi, eta, grid.ra0, grid.dec0);
}

export function worldToGrid(grid, ra, dec) {
  const [xi, eta] = tanProject(ra, dec, grid.ra0, grid.dec0);
  return [grid.c - (xi * 3600) / grid.scale, grid.c - (eta * 3600) / grid.scale];
}

function bilinear(img, x, y) {
  const { nx, ny, data } = img;
  if (!(x >= 0 && y >= 0 && x <= nx - 1 && y <= ny - 1)) return NaN;
  const x0 = Math.min(Math.floor(x), nx - 2), y0 = Math.min(Math.floor(y), ny - 2);
  const tx = x - x0, ty = y - y0;
  const k = y0 * nx + x0;
  return (1 - tx) * (1 - ty) * data[k] + tx * (1 - ty) * data[k + 1] +
    (1 - tx) * ty * data[k + nx] + tx * ty * data[k + nx + 1];
}

function nearest(img, x, y) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= img.nx || yi >= img.ny) return 0;
  return img.data[yi * img.nx + xi];
}

// Flags for a grid pixel whose bilinear value came out NaN: the nearest pixel's bits plus
// the bits of every masked (NaN) pixel in the 2x2 footprint, so each hatched NaN pixel
// carries the flags that blanked it (bilinear spreads one bad pixel over up to 4 grid
// pixels; nearest alone flagged only one). Outside the cutout: no data, no flags.
function nanFlags(cutout, x, y) {
  const { nx, ny, data } = cutout.image;
  if (!(x >= 0 && y >= 0 && x <= nx - 1 && y <= ny - 1)) return 0;
  const x0 = Math.min(Math.floor(x), nx - 2), y0 = Math.min(Math.floor(y), ny - 2);
  let f = nearest(cutout.flags, x, y);
  for (const k of [y0 * nx + x0, y0 * nx + x0 + 1, (y0 + 1) * nx + x0, (y0 + 1) * nx + x0 + 1]) {
    if (Number.isNaN(data[k])) f |= cutout.flags.data[k];
  }
  return f;
}

// Resample a decoded cutout onto `grid`. Returns { n, data: Float32Array, flags: Int32Array }.
export function reproject(cutout, grid) {
  const { n } = grid;
  const data = new Float32Array(n * n);
  const flags = new Int32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [ra, dec] = gridToWorld(grid, i, j);
      const [x, y] = cutout.wcs.worldToPix(ra, dec);
      const v = bilinear(cutout.image, x, y);
      data[j * n + i] = v;
      if (cutout.flags) flags[j * n + i] = Number.isNaN(v) ? nanFlags(cutout, x, y) : nearest(cutout.flags, x, y);
    }
  }
  return { n, data, flags };
}

function median(arr) {
  const a = arr.filter(Number.isFinite).sort((p, q) => p - q);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Background-subtracted, flux-weighted centroid near (x0, y0) on an n×n frame.
// Re-centres a few times. Returns { x, y, flux, peak, bg, sigma, snr } or null
// (sigma = robust noise in the background ring, snr = peak / sigma).
export function centroid(frame, x0, y0, radius = 2.5, iterations = 4) {
  const { n, data } = frame;
  let cx = x0, cy = y0, res = null;
  for (let it = 0; it < iterations; it++) {
    const ann = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const r = Math.hypot(i - cx, j - cy);
      if (r > radius + 2 && r <= radius + 5) ann.push(data[j * n + i]);
    }
    const bg = median(ann);
    const sigma = 1.4826 * median(ann.filter(Number.isFinite).map(v => Math.abs(v - bg)));
    let sw = 0, sx = 0, sy = 0, peak = -Infinity;
    for (let j = Math.floor(cy - radius); j <= Math.ceil(cy + radius); j++) {
      for (let i = Math.floor(cx - radius); i <= Math.ceil(cx + radius); i++) {
        if (i < 0 || j < 0 || i >= n || j >= n || Math.hypot(i - cx, j - cy) > radius) continue;
        const v = data[j * n + i] - (Number.isFinite(bg) ? bg : 0);
        if (!Number.isFinite(v)) continue;
        peak = Math.max(peak, v);
        if (v <= 0) continue;
        sw += v; sx += v * i; sy += v * j;
      }
    }
    if (sw <= 0) return null;
    cx = sx / sw; cy = sy / sw;
    res = { x: cx, y: cy, flux: sw, peak, bg, sigma, snr: sigma > 0 ? peak / sigma : Infinity };
  }
  return res;
}

// Least-squares straight line y = a + b t. Returns { a, b, sigmaB, rms, n }.
export function fitLine(ts, ys) {
  const n = ts.length;
  const mt = ts.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let stt = 0, sty = 0;
  for (let k = 0; k < n; k++) { stt += (ts[k] - mt) ** 2; sty += (ts[k] - mt) * (ys[k] - my); }
  const b = sty / stt, a = my - b * mt;
  let ss = 0;
  for (let k = 0; k < n; k++) ss += (ys[k] - a - b * ts[k]) ** 2;
  const rms = Math.sqrt(ss / Math.max(1, n - 2));
  return { a, b, sigmaB: rms / Math.sqrt(stt), rms, n };
}

// Combine aligned frames pixel by pixel (median: robust to cosmic rays and bad pixels).
// Frames must share one grid. Returns { n, data, count } (count = frames used per pixel).
export function stackFrames(frames, how = 'median') {
  const n = frames[0].n, N = n * n;
  const data = new Float32Array(N), count = new Int32Array(N);
  const vals = new Float64Array(frames.length);
  for (let k = 0; k < N; k++) {
    let m = 0;
    for (const f of frames) { const v = f.data[k]; if (Number.isFinite(v)) vals[m++] = v; }
    count[k] = m;
    if (!m) { data[k] = NaN; continue; }
    const a = Array.from(vals.subarray(0, m));
    if (how === 'mean') data[k] = a.reduce((x, y) => x + y, 0) / m;
    else { a.sort((x, y) => x - y); data[k] = m % 2 ? a[m >> 1] : (a[m / 2 - 1] + a[m / 2]) / 2; }
  }
  return { n, data, count };
}
