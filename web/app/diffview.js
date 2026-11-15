// Compare > Difference (Judging panel b6): last-season stack minus first-season stack on the same grid,
// drawn with a diverging map: blue = fainter later, yellow = brighter later, dark navy-grey = no change in the default
// look; copper / blue / warm grey in the classic copper look (html data-ax-look=classic, access.js).
// A moving star leaves a blue spot where it was and a yellow (copper) spot where it went (a +/- pair);
// a star that only changes brightness turns one colour all over.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

const ok = v => v != null && Number.isFinite(v);
// the look on <html>: only the classic look keeps copper (node tests: no document = the default look)
export const isClassic = () => typeof document !== 'undefined' && document.documentElement.dataset.axLook === 'classic';
// tritanopia (access.js data-ax-diff=rt): red for brighter, teal for fainter, instead of yellow and blue
export const isRT = () => typeof document !== 'undefined' && document.documentElement.dataset.axDiff === 'rt';
const warm = (classic = isClassic(), rt = isRT()) => (classic ? 'copper' : rt ? 'red' : 'yellow');
const cool = (classic = isClassic(), rt = isRT()) => (!classic && rt ? 'teal' : 'blue');
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
// and last-season positions), r: aperture radius in pixels. Lobes: the yellow/copper (+) and blue (-) parts.
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
export function diffCaption(s, name, classic = isClassic()) {
  const who = name || 'The star', w = warm(classic), W = w[0].toUpperCase() + w.slice(1), c = cool(classic), C = c[0].toUpperCase() + c.slice(1);
  if (!s || s.kind === 'unclear') return `${W}: brighter in the last season. ${C}: fainter. ${classic ? 'Grey' : 'Dark'}: no change.`;
  if (s.kind === 'moved') return `${C} where ${who} was, ${w} where it went: it moved ${s.dir} between the seasons.`;
  const pct = Math.round(Math.abs(s.net) * 100);
  if (s.kind === 'same') return `No ${c}–${w} pair and no overall change: ${who} looks the same in both seasons.`;
  return `No ${c}–${w} pair, so no visible motion; the whole star went ${s.kind === 'brighter' ? w : c}: about ${pct}% ${s.kind} (all bands mixed).`;
}

// Diverging colours: t in [-1, 1] (diff / scale, clipped).
// Default look (Master, 16:00): a dark-centre diverging map like 'berlin', so "no change" blends into the navy stage:
// dark neutral #1A2233 at 0, blue #2F6BE0 then bright #7FB2FF below, yellow #E8C400 then bright #FFF27A above. Hue and
// chroma are mixed in OKLab along those stops; the OKLab lightness is the SAME on both sides for the same |difference|
// (it rises from #1A2233's to the mean of the two bright ends), so neither side looks stronger.
// Classic look: grey at 0, blue below, copper above.
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export function toLab(rgb) {
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromLab([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map(v => Math.round(gam(Math.min(1, Math.max(0, v)))));
}
const VZ = toLab([26, 34, 51]), VUP = [toLab([232, 196, 0]), toLab([255, 242, 122])], VDN = [toLab([47, 107, 224]), toLab([127, 178, 255])];
// tritanopia: red #D0342C then bright #FF9E8C above, teal #00A39A then bright #7FE6DC below (same lightness rule)
const TUP = [toLab([208, 52, 44]), toLab([255, 158, 140])], TDN = [toLab([0, 163, 154]), toLab([127, 230, 220])];
const VMID = 0.55, TEND = (TUP[1][0] + TDN[1][0]) / 2, LEND = (VUP[1][0] + VDN[1][0]) / 2; // where the mid colour sits, and the shared end lightness
const ZERO = [52, 46, 41], UP = [[0.55, [214, 128, 64]], [1, [255, 232, 196]]], DOWN = [[0.55, [74, 132, 214]], [1, [206, 228, 255]]];
const K = Math.asinh(4);
export function diffColor(t, classic = isClassic(), rt = isRT()) {
  const s = Math.max(-1, Math.min(1, t)), u = Math.asinh(4 * Math.abs(s)) / K;
  if (!classic) {
    const [m, e] = s >= 0 ? (rt ? TUP : VUP) : (rt ? TDN : VDN), a = u <= VMID ? VZ : m, b = u <= VMID ? m : e, f = u <= VMID ? u / VMID : (u - VMID) / (1 - VMID);
    const c = [0, 1, 2].map(j => a[j] + (b[j] - a[j]) * f);
    c[0] = VZ[0] + ((rt ? TEND : LEND) - VZ[0]) * u; // lightness: symmetric in |difference|
    return fromLab(c);
  }
  const stops = s >= 0 ? UP : DOWN;
  let a = [0, ZERO], b = stops[0];
  if (u > stops[0][0]) { a = stops[0]; b = stops[1]; }
  const f = (u - a[0]) / (b[0] - a[0]);
  return [0, 1, 2].map(j => Math.round(a[1][j] + (b[1][j] - a[1][j]) * f));
}
export const diffRampCss = (classic = isClassic()) => 'linear-gradient(90deg,' + [-1, -0.5, -0.15, 0, 0.15, 0.5, 1].map((t, i) => `rgb(${diffColor(t, classic)}) ${(i / 6 * 100).toFixed(1)}%`).join(',') + ')';
// the Difference key's tooltip follows the look (index.html holds the copper words; set again on every colour change)
const Cap = w => w[0].toUpperCase() + w.slice(1);
export const diffKeyTitle = (classic = isClassic()) => `Difference: last season minus first season. ${Cap(warm(classic))} = brighter later, ${cool(classic)} = fainter later`;
function syncKey() { const k = document.getElementById('diffKey'); if (k) k.title = diffKeyTitle(); }
if (typeof document !== 'undefined') { document.documentElement.addEventListener('star-shift-colours', syncKey); syncKey(); }

// Draw the difference (browser). No-data pixels get the same calm flat fill as the image views.
export function drawDiff(canvas, img, { cell = 16, noData = '#100D0B' } = {}) {
  const { n, d, scale } = img, c = cell, g = canvas.getContext('2d');
  if (canvas.width !== n * c || canvas.height !== n * c) { canvas.width = n * c; canvas.height = n * c; }
  const classic = isClassic();
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = d[y * n + x];
    g.fillStyle = v == null ? noData : `rgb(${diffColor(v / scale, classic)})`;
    g.fillRect(x * c, y * c, c, c);
  }
}

// Legend: "Later minus earlier: fainter [ramp] brighter"; Expert adds the colour-scale ends (± the 99th percentile).
export function diffLegend(img, unit = 'MJy/sr', classic = isClassic()) {
  const f = v => (v >= 100 ? String(Math.round(v)) : v < 0.01 ? v.toExponential(1) : v.toFixed(v >= 10 ? 1 : 3));
  const s = img ? f(img.scale) : '';
  return `<span class="df-t">Later minus earlier:</span><span class="df-end">fainter</span><i class="df-ramp" style="background:${diffRampCss(classic)}" title="${Cap(warm(classic))} = brighter later, ${cool(classic)} = fainter later"></i><span class="df-end">brighter</span>`
    + `<span class="df-t x-only">colour scale ±${s} ${unit}<span class="df-pct"> (99th percentile)</span></span>`;
}
