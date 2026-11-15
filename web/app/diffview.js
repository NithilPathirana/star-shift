// Compare > Difference (Judging panel b6): last-season stack minus first-season stack on the same grid,
// drawn with a diverging map (copper = brighter later, blue = fainter later, warm grey = no change).
// A moving star leaves a blue spot where it was and a copper spot where it went (a +/- pair);
// a star that only changes brightness turns one colour all over.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

const ok = v => v != null && Number.isFinite(v);
function quantile(vals, p) {
  if (!vals.length) return NaN;
  const v = Float64Array.from(vals).sort();
  return v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
}

// a, b: the two stacks' pixels (length n*n, null/NaN = no data). Each stack's sky level (median) is
// taken off first, so a season with brighter zodiacal glow doesn't tint the whole picture.
// Returns { n, d (number|null per pixel), scale (99th percentile of |d|), bgA, bgB, valid }.
export function diffImage(a, b, n) {
  const N = n * n, va = [], vb = [];
  for (let k = 0; k < N; k++) { if (ok(a[k])) va.push(a[k]); if (ok(b[k])) vb.push(b[k]); }
  const bgA = va.length ? quantile(va, 0.5) : 0, bgB = vb.length ? quantile(vb, 0.5) : 0;
  const d = new Array(N).fill(null), abs = [];
  for (let k = 0; k < N; k++) {
    if (!ok(a[k]) || !ok(b[k])) continue;
    d[k] = (b[k] - bgB) - (a[k] - bgA); abs.push(Math.abs(d[k]));
  }
  const scale = abs.length ? quantile(abs, 0.99) : 0;
  return { n, d, scale: scale > 0 ? scale : 1e-9, bgA, bgB, valid: abs.length };
}

const DIR8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
// grid: x grows to the west (east is left), y grows to the south (north is up)
export const dirOf = (dx, dy) => DIR8[Math.round((((Math.atan2(-dx, -dy) * 180 / Math.PI) % 360) + 360) % 360 / 45) % 8];

// What the difference shows around the star. at: [x, y] centre of the star's spot (between its first-
// and last-season positions), r: aperture radius in pixels. Lobes: the copper (+) and blue (-) parts.
// kind: 'moved' (a +/- pair more than 1 px apart, each lobe a real part of the star's light),
// 'brighter' / 'fainter' (one colour, net change >= 15 %), 'same', or 'unclear' (no star light measured).
export function diffStar(img, a, at, r = 4) {
  const { n, d, bgA } = img;
  let P = 0, Nn = 0, px = 0, py = 0, nx = 0, ny = 0, ref = 0, m = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x;
    if (d[k] == null || (x - at[0]) ** 2 + (y - at[1]) ** 2 > r * r) continue;
    const v = d[k]; m++;
    if (v > 0) { P += v; px += v * x; py += v * y; } else { Nn -= v; nx -= v * x; ny -= v * y; }
    ref += Math.max(0, a[k] - bgA);
  }
  const out = { pos: P, neg: Nn, ref, pixels: m, net: ref > 0 ? (P - Nn) / ref : 0, sep: 0, dx: 0, dy: 0, dir: null, kind: 'unclear' };
  if (!(ref > 0) || m < 5) return out;
  if (P > 0 && Nn > 0) {
    out.dx = px / P - nx / Nn; out.dy = py / P - ny / Nn;
    out.sep = Math.hypot(out.dx, out.dy); out.dir = dirOf(out.dx, out.dy);
  }
  const lobe = Math.min(P, Nn) / ref;
  if (out.sep >= 1 && lobe >= 0.1) out.kind = 'moved';
  else if (Math.abs(out.net) >= 0.15) out.kind = out.net > 0 ? 'brighter' : 'fainter';
  else out.kind = 'same';
  return out;
}

// One-line caption for the stage (plain words; the scale numbers are Expert, in the legend).
export function diffCaption(s, name) {
  const who = name || 'The star';
  if (!s || s.kind === 'unclear') return 'Copper: brighter in the last season. Blue: fainter. Grey: no change.';
  if (s.kind === 'moved') return `Blue where ${who} was, copper where it went: it moved ${s.dir} between the seasons.`;
  const pct = Math.round(Math.abs(s.net) * 100);
  if (s.kind === 'same') return `No blue–copper pair and no overall change: ${who} looks the same in both seasons.`;
  return `No blue–copper pair, so no visible motion; the whole star went ${s.kind === 'brighter' ? 'copper' : 'blue'}: about ${pct}% ${s.kind} (all bands mixed).`;
}

// Diverging colours: t in [-1, 1] (diff / scale, clipped). Grey at 0, blue below, copper above.
const ZERO = [52, 46, 41], UP = [[0.55, [214, 128, 64]], [1, [255, 232, 196]]], DOWN = [[0.55, [74, 132, 214]], [1, [206, 228, 255]]];
const K = Math.asinh(4);
export function diffColor(t) {
  const s = Math.max(-1, Math.min(1, t)), u = Math.asinh(4 * Math.abs(s)) / K, stops = s >= 0 ? UP : DOWN;
  let a = [0, ZERO], b = stops[0];
  if (u > stops[0][0]) { a = stops[0]; b = stops[1]; }
  const f = (u - a[0]) / (b[0] - a[0]);
  return [0, 1, 2].map(j => Math.round(a[1][j] + (b[1][j] - a[1][j]) * f));
}
export const diffRampCss = () => 'linear-gradient(90deg,' + [-1, -0.5, -0.15, 0, 0.15, 0.5, 1].map((t, i) => `rgb(${diffColor(t)}) ${(i / 6 * 100).toFixed(1)}%`).join(',') + ')';

// Draw the difference (browser). No-data pixels get the same calm flat fill as the image views.
export function drawDiff(canvas, img, { cell = 16, noData = '#100D0B' } = {}) {
  const { n, d, scale } = img, c = cell, g = canvas.getContext('2d');
  if (canvas.width !== n * c) { canvas.width = n * c; canvas.height = n * c; }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = d[y * n + x];
    g.fillStyle = v == null ? noData : `rgb(${diffColor(v / scale)})`;
    g.fillRect(x * c, y * c, c, c);
  }
}

// Legend: "Later minus earlier: fainter [ramp] brighter"; Expert adds the colour-scale ends (± the 99th percentile).
export function diffLegend(img, unit = 'MJy/sr') {
  const f = v => (v >= 100 ? String(Math.round(v)) : v < 0.01 ? v.toExponential(1) : v.toFixed(v >= 10 ? 1 : 3));
  const s = img ? f(img.scale) : '';
  return `<span class="df-t">Later minus earlier:</span><span class="df-end">fainter</span><i class="df-ramp" style="background:${diffRampCss()}"></i><span class="df-end">brighter</span>`
    + `<span class="df-t x-only">colour scale ±${s} ${unit}<span class="df-pct"> (99th percentile)</span></span>`;
}
