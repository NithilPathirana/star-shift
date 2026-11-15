// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// "Your photo -> the sky": a small plate solver that runs entirely in the browser (and in Node for tests).
// 1. find stars on a luminance image (local peaks + centroids on a median-background-subtracted image);
// 2. match quads of the brightest stars against quads of Hipparcos stars with a 4-D geometric hash
//    (the astrometry.net idea: Lang, Hogg, Mierle, Blanton & Roweis 2010, AJ 139, 1782);
// 3. verify every candidate with more stars, and only accept a solve whose matches can't be chance.
// Model: gnomonic (TAN) projection about the photo's centre + a similarity (scale, rotation, shift),
// so normal (rectilinear) camera lenses; fisheye photos are out of scope.

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const norm360 = (x) => ((x % 360) + 360) % 360;

// ---- sphere ---------------------------------------------------------------------------------------
export function vec(ra, dec) { const a = ra * D2R, d = dec * D2R, c = Math.cos(d); return [c * Math.cos(a), c * Math.sin(a), Math.sin(d)]; }
export function radecOf(v) { const r = Math.hypot(v[0], v[1], v[2]) || 1; return { ra: norm360(Math.atan2(v[1], v[0]) * R2D), dec: Math.asin(Math.max(-1, Math.min(1, v[2] / r))) * R2D }; }
export function sepDeg(ra1, dec1, ra2, dec2) {
  const a = vec(ra1, dec1), b = vec(ra2, dec2);
  return 2 * Math.asin(Math.min(1, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 2)) * R2D;
}
// tangent-plane basis at (ra0, dec0): p0 = centre, E = east, N = north
function basis(ra0, dec0) {
  const a = ra0 * D2R, d = dec0 * D2R;
  return { p: vec(ra0, dec0), E: [-Math.sin(a), Math.cos(a), 0], N: [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)] };
}
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
// gnomonic: unit vector -> [xi, eta] (radians-ish, east/north), null behind the plane
function tanV(v, B) { const c = dot(v, B.p); if (c <= 1e-6) return null; return [dot(v, B.E) / c, dot(v, B.N) / c]; }
function untanV(xi, eta, B) {
  const x = B.p[0] + xi * B.E[0] + eta * B.N[0], y = B.p[1] + xi * B.E[1] + eta * B.N[1], z = B.p[2] + xi * B.E[2] + eta * B.N[2];
  const r = Math.hypot(x, y, z); return [x / r, y / r, z / r];
}

// ---- the plate solution ---------------------------------------------------------------------------
// sol = { ra0, dec0, a, b, tx, ty, m, cx, cy }: px = x - cx, py = m (y - cy);
// xi = a px - b py + tx, eta = b px + a py + ty (tangent plane about ra0/dec0). m = -1: mirrored photo.
// Optional radial lens distortion k (sol.k): undistorted = p (1 + k |p|^2 / R2), R2 = half-diagonal squared.
const R2of = (sol) => sol.cx * sol.cx + sol.cy * sol.cy;
function undist(sol, px, py) { const k = sol.k || 0; if (!k) return [px, py]; const f = 1 + k * (px * px + py * py) / R2of(sol); return [px * f, py * f]; }
function redist(sol, ux, uy) {
  const k = sol.k || 0; if (!k) return [ux, uy];
  let px = ux, py = uy; for (let i = 0; i < 10; i++) { const f = 1 + k * (px * px + py * py) / R2of(sol); px = ux / f; py = uy / f; }
  return [px, py];
}
export function pixToSky(sol, x, y) {
  const [px, py] = undist(sol, x - sol.cx, sol.m * (y - sol.cy)), B = sol.B || (sol.B = basis(sol.ra0, sol.dec0));
  return radecOf(untanV(sol.a * px - sol.b * py + sol.tx, sol.b * px + sol.a * py + sol.ty, B));
}
export function skyToPix(sol, ra, dec) {
  const B = sol.B || (sol.B = basis(sol.ra0, sol.dec0)), t = tanV(vec(ra, dec), B);
  if (!t) return null;
  const u = t[0] - sol.tx, v = t[1] - sol.ty, det = sol.a * sol.a + sol.b * sol.b;
  const [px, py] = redist(sol, (sol.a * u + sol.b * v) / det, (-sol.b * u + sol.a * v) / det);
  return { x: sol.cx + px, y: sol.cy + sol.m * py };
}
export const scaleDeg = (sol) => Math.hypot(sol.a, sol.b) * R2D; // degrees per pixel (at the centre)
// Position angle of the photo's "up" direction, degrees east of north (0 = north is up).
export function upAngle(sol) { const xi = sol.b * sol.m, eta = -sol.a * sol.m; return norm360(Math.atan2(xi, eta) * R2D); }

// least-squares similarity from pairs [px, py] -> [xi, eta]
function simFit(P, Q) {
  const n = P.length; let mx = 0, my = 0, mu = 0, mv = 0;
  for (let i = 0; i < n; i++) { mx += P[i][0]; my += P[i][1]; mu += Q[i][0]; mv += Q[i][1]; }
  mx /= n; my /= n; mu /= n; mv /= n;
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    const x = P[i][0] - mx, y = P[i][1] - my, u = Q[i][0] - mu, v = Q[i][1] - mv;
    s += x * x + y * y; sa += x * u + y * v; sb += x * v - y * u;
  }
  if (!(s > 0)) return null;
  const a = sa / s, b = sb / s;
  return { a, b, tx: mu - a * mx + b * my, ty: mv - b * mx - a * my };
}

// Fit the solution to pairs [{x, y, v}] (v = unit vector of the catalogue star), re-centring the
// tangent point on the photo's centre a few times. Returns { sol, rms } (rms in pixels).
export function fitPairs(pairs, m, cx, cy, start, k = 0) {
  let c = start || radecOf(pairs[0].v), sol = null;
  for (let it = 0; it < 4; it++) {
    const B = basis(c.ra, c.dec), P = [], Q = [];
    for (const p of pairs) { const t = tanV(p.v, B); if (!t) return null; P.push(undist({ k, cx, cy }, p.x - cx, m * (p.y - cy))); Q.push(t); }
    const f = simFit(P, Q); if (!f) return null;
    sol = { ra0: c.ra, dec0: c.dec, ...f, m, cx, cy, k, B };
    const nc = radecOf(untanV(f.tx, f.ty, B));
    if (it > 0 && Math.abs(f.tx) < 1e-9 && Math.abs(f.ty) < 1e-9) break;
    c = nc;
  }
  let ss = 0;
  for (const p of pairs) { const r = radecOf(p.v), q = skyToPix(sol, r.ra, r.dec); if (!q) return null; ss += (q.x - p.x) ** 2 + (q.y - p.y) ** 2; }
  return { sol, rms: Math.sqrt(ss / pairs.length) };
}

// ---- star detection -------------------------------------------------------------------------------
// lum: Float32Array (w*h), any scale. Returns { stars (brightest first: { x, y, flux, peak }), sigma, rejected }.
// Peaks are found on a lightly smoothed copy (Gaussian sigma 1 px) above nsig x its noise (MAD), and must cover
// at least minPix connected pixels. Thrown out: big blobs (Moon, lamps), strongly elongated ones (trails,
// edges) and peaks that border a dark silhouette (sky seen through trees, gaps between roofs).
export function detectStars(lum, w, h, { max = 200, nsig = 5, block = 32, minPix = 4 } = {}) {
  // background: median of each block, bilinear between block centres
  const bw = Math.max(1, Math.ceil(w / block)), bh = Math.max(1, Math.ceil(h / block)), med = new Float32Array(bw * bh);
  const buf = new Float32Array(block * block);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let n = 0;
    for (let y = by * block; y < Math.min(h, by * block + block); y++) for (let x = bx * block; x < Math.min(w, bx * block + block); x++) buf[n++] = lum[y * w + x];
    const s = buf.subarray(0, n).sort(); med[by * bw + bx] = s[n >> 1];
  }
  const bgAt = (x, y) => {
    const fx = Math.min(bw - 1, Math.max(0, x / block - 0.5)), fy = Math.min(bh - 1, Math.max(0, y / block - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    return (med[y0 * bw + x0] * (1 - ax) + med[y0 * bw + x1] * ax) * (1 - ay) + (med[y1 * bw + x0] * (1 - ax) + med[y1 * bw + x1] * ax) * ay;
  };
  const r = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) r[y * w + x] = lum[y * w + x] - bgAt(x, y);
  // Gaussian smoothing, sigma 1 px (separable 5-tap)
  const K = [0.0545, 0.2442, 0.4026, 0.2442, 0.0545], tmp = new Float32Array(w * h), sm = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let k = -2; k <= 2; k++) a += K[k + 2] * r[y * w + Math.min(w - 1, Math.max(0, x + k))]; tmp[y * w + x] = a; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let k = -2; k <= 2; k++) a += K[k + 2] * tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]; sm[y * w + x] = a; }
  // noise: median absolute deviation of a pixel sample (of the smoothed and of the raw image)
  const mad = (arr) => { const step = Math.max(1, Math.floor((w * h) / 40000)), v = []; for (let i = 0; i < w * h; i += step) v.push(Math.abs(arr[i])); v.sort((p, q) => p - q); return 1.4826 * v[v.length >> 1]; };
  let max0 = 0; for (let i = 0; i < r.length; i++) if (r[i] > max0) max0 = r[i];
  const sigma = Math.max(mad(r), max0 * 1e-3, 1e-6), sigS = Math.max(mad(sm), max0 * 3e-4, 1e-6), thr = nsig * sigS;
  // dark silhouettes: only when the image has blocks far darker than its sky (trees, buildings, hills)
  const sortedMed = [...med].sort((p, q) => p - q), skyRef = sortedMed[Math.floor(0.75 * (sortedMed.length - 1))], p5 = sortedMed[Math.floor(0.02 * (sortedMed.length - 1))];
  // "dark" = under a quarter of the sky level (trees, roofs): a sky-glow gradient or vignetting is never that dark
  const darkLim = p5 < 0.25 * skyRef && 0.75 * skyRef > 6 * sigma ? 0.25 * skyRef : -Infinity;
  const R = 3, E = 4, CAP = 400, out = [], rejected = { small: 0, blob: 0, elongated: 0, silhouette: 0 };
  const mark = new Int32Array(w * h), stack = new Int32Array(CAP + 8 * CAP);
  let id = 0;
  for (let y = E; y < h - E; y++) for (let x = E; x < w - E; x++) {
    const i = y * w + x, v = sm[i];
    if (v < thr) continue;
    let peak = true;
    for (let dy = -R; dy <= R && peak; dy++) for (let dx = -R; dx <= R; dx++) {
      if (!dx && !dy) continue;
      const u = sm[i + dy * w + dx];
      if (u > v || (u === v && (dy < 0 || (dy === 0 && dx < 0)))) { peak = false; break; }
    }
    if (!peak) continue;
    // connected pixels above the threshold (8-neighbours), with their second moments
    id++; let n = 0, sp = 0, sw = 0, mx = 0, my = 0, mxx = 0, myy = 0, mxy = 0;
    stack[sp++] = i; mark[i] = id;
    while (sp && n <= CAP) {
      const j = stack[--sp], jx = j % w, jy = (j - jx) / w, wt = sm[j];
      n++; sw += wt; mx += wt * jx; my += wt * jy; mxx += wt * jx * jx; myy += wt * jy * jy; mxy += wt * jx * jy;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = jx + dx, Y = jy + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const q = Y * w + X; if (mark[q] === id || sm[q] < thr) continue;
        mark[q] = id; if (sp < stack.length) stack[sp++] = q;
      }
    }
    if (n < minPix) { rejected.small++; continue; }
    if (n > CAP) { rejected.blob++; continue; }
    if (n >= 6) {
      mx /= sw; my /= sw;
      const a = mxx / sw - mx * mx, c = myy / sw - my * my, b = mxy / sw - mx * my, tr = a + c, dt = Math.sqrt(Math.max(0, (a - c) ** 2 / 4 + b * b));
      const l1 = tr / 2 + dt, l2 = Math.max(1e-6, tr / 2 - dt);
      if (l1 / l2 > 6.25 && l1 > 1) { rejected.elongated++; continue; } // axis ratio over 2.5
    }
    if (darkLim > -Infinity) {
      let dark = 0, tot = 0; const Rs = 10;
      for (let dy = -Rs; dy <= Rs; dy += 2) for (let dx = -Rs; dx <= Rs; dx += 2) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        tot++; if (lum[Y * w + X] < darkLim) dark++;
      }
      if (dark > 0.3 * tot) { rejected.silhouette++; continue; }
    }
    let sx = 0, sy = 0, sf = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const u = r[i + dy * w + dx]; if (u <= 0) continue; sx += u * dx; sy += u * dy; sf += u;
    }
    if (!(sf > 0)) continue;
    out.push({ x: x + sx / sf, y: y + sy / sf, flux: sf, peak: r[i] });
  }
  out.sort((p, q) => q.flux - p.flux);
  return { stars: out.slice(0, max), sigma, rejected };
}

// ---- catalogue ------------------------------------------------------------------------------------
// json: web/app/data/stars.json ({ fields: [hip, ra, dec, vmag, bv], stars, names }), sorted brightest first.
export function prepareCatalogue(json) {
  const rows = [...json.stars].sort((a, b) => a[3] - b[3]), n = rows.length;
  const cat = { n, hip: new Int32Array(n), ra: new Float64Array(n), dec: new Float64Array(n), mag: new Float32Array(n), v: new Float64Array(3 * n), names: json.names || {} };
  rows.forEach((s, i) => {
    cat.hip[i] = s[0]; cat.ra[i] = s[1]; cat.dec[i] = s[2]; cat.mag[i] = s[3];
    const p = vec(s[1], s[2]); cat.v[3 * i] = p[0]; cat.v[3 * i + 1] = p[1]; cat.v[3 * i + 2] = p[2];
  });
  return cat;
}
export const starName = (cat, i) => cat.names[cat.hip[i]] || null;
const cv = (cat, i) => [cat.v[3 * i], cat.v[3 * i + 1], cat.v[3 * i + 2]];

// 3-D cube grid over unit vectors, for "stars within r degrees" lookups among a subset (idx)
function skyGrid(cat, idx, rDeg) {
  const chord = 2 * Math.sin(rDeg * D2R / 2), n = Math.max(1, Math.min(48, Math.floor(2 / chord))), cs = 2 / n;
  const cell = (q) => Math.min(n - 1, Math.max(0, Math.floor((q + 1) / cs)));
  const head = new Int32Array(n * n * n).fill(-1), next = new Int32Array(idx.length);
  idx.forEach((s, k) => { const c = (cell(cat.v[3 * s]) * n + cell(cat.v[3 * s + 1])) * n + cell(cat.v[3 * s + 2]); next[k] = head[c]; head[c] = k; });
  // all members within chord distance rc of unit vector p: calls f(starIndex, chord^2)
  const near = (p, rc, f) => {
    const span = Math.ceil(rc / cs), x0 = cell(p[0]), y0 = cell(p[1]), z0 = cell(p[2]), rc2 = rc * rc;
    for (let x = Math.max(0, x0 - span); x <= Math.min(n - 1, x0 + span); x++)
      for (let y = Math.max(0, y0 - span); y <= Math.min(n - 1, y0 + span); y++)
        for (let z = Math.max(0, z0 - span); z <= Math.min(n - 1, z0 + span); z++)
          for (let k = head[(x * n + y) * n + z]; k >= 0; k = next[k]) {
            const s = idx[k], dx = cat.v[3 * s] - p[0], dy = cat.v[3 * s + 1] - p[1], dz = cat.v[3 * s + 2] - p[2], d2 = dx * dx + dy * dy + dz * dz;
            if (d2 <= rc2) f(s, d2);
          }
  };
  return { near };
}
const chordOf = (deg) => 2 * Math.sin(deg * D2R / 2);

// ---- quads ----------------------------------------------------------------------------------------
// Code of 4 points (2-D): the widest pair A, B fixed at (0,0) and (1,1); code = C and D in that frame.
// Returns { code: [xc, yc, xd, yd], ord: [iA, iB, iC, iD] } (ord indexes into pts).
export function quadCode(pts) {
  let best = -1, ia = 0, ib = 1;
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const d = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2; if (d > best) { best = d; ia = i; ib = j; }
  }
  let [ic, id] = [0, 1, 2, 3].filter(k => k !== ia && k !== ib);
  const frame = (A, B) => {
    const dx = B[0] - A[0], dy = B[1] - A[1], d2 = dx * dx + dy * dy;
    return (P) => { const rx = P[0] - A[0], ry = P[1] - A[1], u = (rx * dx + ry * dy) / d2, v = (ry * dx - rx * dy) / d2; return [u - v, u + v]; }; // (rel/d)*(1+i)
  };
  let f = frame(pts[ia], pts[ib]), c = f(pts[ic]), d = f(pts[id]);
  if (c[0] + d[0] > 1) { [ia, ib] = [ib, ia]; f = frame(pts[ia], pts[ib]); c = f(pts[ic]); d = f(pts[id]); }
  if (c[0] > d[0]) { [ic, id] = [id, ic]; [c, d] = [d, c]; }
  return { code: [c[0], c[1], d[0], d[1]], ord: [ia, ib, ic, id] };
}

const CELL = 0.02, TBITS = 20, TSIZE = 1 << TBITS;
const qcell = (x) => Math.floor((x + 1) / CELL);
const qhash = (a, b, c, d) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791) ^ Math.imul(d, 49979687)) & (TSIZE - 1);

// One "band": the catalogue thinned to a density that matches a photo of this field of view, its quads and hash.
// fov = long side (deg), aspect = short/long, nImg = stars used from the photo. keep(i) optional filter (horizon).
export function buildBand(cat, { fov, aspect = 0.67, nImg = 30, ratio = 2.5, K = 9, keep = null, cap = 6000 }) {
  const area = fov * fov * aspect, want = Math.min(cap, Math.round(ratio * nImg * 41253 / area));
  const idx = [];
  for (let i = 0; i < cat.n && idx.length < want; i++) if (!keep || keep(i)) idx.push(i);
  const density = idx.length / 41253 * (keep ? 2 : 1); // per deg2 (a horizon cut keeps ~half the sky)
  const rNN = Math.sqrt((3 * K) / (Math.PI * density)); // radius expected to hold ~3K stars
  const grid = skyGrid(cat, idx, rNN);
  const quads = [], codes = [], seen = new Set(), S = cat.n + 1;
  for (const i of idx) {
    const p = cv(cat, i), nb = [];
    grid.near(p, chordOf(rNN), (s, d2) => { if (s !== i) nb.push([d2, s]); });
    nb.sort((a, b) => a[0] - b[0]);
    const kn = nb.slice(0, K).map(x => x[1]);
    if (kn.length < 3) continue;
    const B = basis(cat.ra[i], cat.dec[i]);
    const P = new Map([[i, [0, 0]]]); for (const s of kn) P.set(s, tanV(cv(cat, s), B));
    for (let a = 0; a < kn.length; a++) for (let b = a + 1; b < kn.length; b++) for (let c = b + 1; c < kn.length; c++) {
      const m = [i, kn[a], kn[b], kn[c]], srt = [...m].sort((x, y) => x - y), key = ((srt[0] * S + srt[1]) * S + srt[2]) * S + srt[3];
      if (seen.has(key)) continue; seen.add(key);
      const q = quadCode(m.map(s => P.get(s)));
      quads.push(m[q.ord[0]], m[q.ord[1]], m[q.ord[2]], m[q.ord[3]]); codes.push(...q.code);
    }
  }
  const nq = quads.length / 4, head = new Int32Array(TSIZE).fill(-1), next = new Int32Array(nq);
  const Q = Int32Array.from(quads), C = Float32Array.from(codes);
  for (let k = 0; k < nq; k++) { const h = qhash(qcell(C[4 * k]), qcell(C[4 * k + 1]), qcell(C[4 * k + 2]), qcell(C[4 * k + 3])); next[k] = head[h]; head[h] = k; }
  return { fov, idx, grid, Q, C, head, next, nq, density };
}

function lookup(band, code, tol, f) {
  const q = code.map(qcell), t2 = tol * tol;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (let d = -1; d <= 1; d++) {
    for (let k = band.head[qhash(q[0] + a, q[1] + b, q[2] + c, q[3] + d)]; k >= 0; k = band.next[k]) {
      const C = band.C, e = (C[4 * k] - code[0]) ** 2 + (C[4 * k + 1] - code[1]) ** 2 + (C[4 * k + 2] - code[2]) ** 2 + (C[4 * k + 3] - code[3]) ** 2;
      if (e <= t2) f(k);
    }
  }
}

// image quads: each of the top-N stars with 3 of its K nearest (top-N) neighbours
function imageQuads(stars, N, K = 4) {
  const top = stars.slice(0, N), out = [], seen = new Set();
  top.forEach((s, i) => {
    const nb = top.map((t, j) => [(t.x - s.x) ** 2 + (t.y - s.y) ** 2, j]).filter(x => x[1] !== i).sort((a, b) => a[0] - b[0]).slice(0, K).map(x => x[1]);
    for (let a = 0; a < nb.length; a++) for (let b = a + 1; b < nb.length; b++) for (let c = b + 1; c < nb.length; c++) {
      const m = [i, nb[a], nb[b], nb[c]], key = [...m].sort((x, y) => x - y).join(',');
      if (!seen.has(key)) { seen.add(key); out.push(m); }
    }
  });
  return out;
}

// Match image stars to catalogue stars (one each, nearest first) within tolPx. Returns pairs.
export function matchStars(sol, stars, cat, grid, tolPx, nUse) {
  const tolDeg = tolPx * scaleDeg(sol), rc = chordOf(tolDeg), cand = [];
  stars.slice(0, nUse).forEach((s, j) => {
    const r = pixToSky(sol, s.x, s.y), p = vec(r.ra, r.dec);
    grid.near(p, rc, (i, d2) => cand.push([d2, j, i]));
  });
  cand.sort((a, b) => a[0] - b[0]);
  const usedI = new Set(), usedS = new Set(), pairs = [];
  for (const [, j, i] of cand) { if (usedI.has(j) || usedS.has(i)) continue; usedI.add(j); usedS.add(i); pairs.push({ x: stars[j].x, y: stars[j].y, v: cv(cat, i), star: i, img: j }); }
  return pairs;
}

// chance matches expected: nUse photo stars, each with probability (catalogue stars in the field x circle area / photo area)
function chance(band, sol, w, h, tolPx, nUse) {
  const areaDeg = w * h * scaleDeg(sol) ** 2, inField = band.density * areaDeg;
  return nUse * inField * Math.PI * tolPx * tolPx / (w * h);
}

// After a confident match: fit the lens's radial distortion too (wide-angle lenses bend the corners).
function refineK(pairs, sol) {
  let k = 0, f = null;
  for (let it = 0; it < 5; it++) {
    f = fitPairs(pairs, sol.m, sol.cx, sol.cy, { ra: sol.ra0, dec: sol.dec0 }, k);
    if (!f) return null;
    const S = f.sol, R2 = R2of(S), det = S.a * S.a + S.b * S.b; let num = 0, den = 0;
    for (const p of pairs) {
      const t = tanV(p.v, S.B); if (!t) return null;
      const u = t[0] - S.tx, v = t[1] - S.ty, ux = (S.a * u + S.b * v) / det, uy = (-S.b * u + S.a * v) / det;
      const px = p.x - S.cx, py = S.m * (p.y - S.cy), q = (px * px + py * py) / R2;
      num += ((ux - px) * px + (uy - py) * py) * q; den += (px * px + py * py) * q * q;
    }
    if (!(den > 0)) return null;
    k = Math.max(-0.25, Math.min(0.25, num / den));
  }
  return fitPairs(pairs, sol.m, sol.cx, sol.cy, { ra: sol.ra0, dec: sol.dec0 }, k);
}
const rmsOf = (sol, pairs) => { let ss = 0; for (const p of pairs) { const r = radecOf(p.v), q = skyToPix(sol, r.ra, r.dec); ss += (q.x - p.x) ** 2 + (q.y - p.y) ** 2; } return Math.sqrt(ss / Math.max(1, pairs.length)); };

// Refine a candidate solution with all matched stars, then judge it.
function verify(cat, band, stars, sol0, w, h, tolPx, nUse) {
  let sol = sol0, pairs = [];
  for (let it = 0; it < 3; it++) {
    pairs = matchStars(sol, stars, cat, band.grid, tolPx, nUse);
    if (pairs.length < 4) return null;
    const f = fitPairs(pairs, sol.m, sol.cx, sol.cy, { ra: sol.ra0, dec: sol.dec0 });
    if (!f) return null;
    sol = f.sol;
  }
  pairs = matchStars(sol, stars, cat, band.grid, tolPx, nUse);
  const lam = chance(band, sol, w, h, tolPx, nUse), need = Math.max(8, Math.ceil(4 + lam + 5 * Math.sqrt(lam) + 2));
  let rms = rmsOf(sol, pairs);
  if (pairs.length >= need && pairs.length >= 12) { // only once accepted: the extra lens term never decides a match
    const kf = refineK(pairs, sol);
    if (kf) { const p2 = matchStars(kf.sol, stars, cat, band.grid, tolPx, nUse), r2 = rmsOf(kf.sol, p2); if (p2.length >= pairs.length && r2 < rms) { sol = kf.sol; pairs = p2; rms = r2; } }
  }
  return { sol, pairs, matched: pairs.length, used: Math.min(nUse, stars.length), chance: lam, need, ok: pairs.length >= need, rmsPx: rms };
}

// Blind search order of field-of-view bands (long side, degrees).
export const BLIND_FOVS = [45, 65, 30, 95, 20];

// The solver. stars from detectStars; w, h the image size in pixels.
// hints: { fov (long side deg, from the lens), keep(i) (catalogue filter, e.g. above the horizon) }.
// onProgress(text) is awaited between bands so the page stays responsive. Returns a result or { ok: false }.
export async function solve(cat, stars, w, h, { fov = null, keep = null, onProgress = null, bands = null, nImg = 30 } = {}) {
  const t0 = Date.now(), cx = w / 2, cy = h / 2, long = Math.max(w, h), aspect = Math.min(w, h) / long;
  const tolPx = Math.max(2.5, 0.006 * Math.hypot(w, h)), nUse = Math.min(60, stars.length), nQ = Math.min(nImg, stars.length);
  if (nQ < 6) return { ok: false, reason: 'few-stars', found: stars.length };
  const fovs = fov ? [fov, ...BLIND_FOVS.filter(f => Math.abs(Math.log(f / fov)) > 0.3)] : BLIND_FOVS;
  const iq = imageQuads(stars, nQ);
  let best = null, tried = 0;
  for (const F of (bands || fovs)) {
    if (onProgress) await onProgress(`Trying a field about ${Math.round(F)}° wide…`);
    const band = buildBand(cat, { fov: F, aspect, nImg: nQ, keep });
    const lo = F / 1.7 / long, hi = F * 1.7 / long; // deg per pixel allowed in this band
    const seen = new Set();
    for (const m of [1, -1]) for (const q of iq) {
      const pts = q.map(j => [stars[j].x, m * stars[j].y]), qc = quadCode(pts), ordered = qc.ord.map(k => q[k]);
      lookup(band, qc.code, 0.03, (k) => {
        const key = `${m}:${k}:${ordered.join(',')}`; if (seen.has(key)) return; seen.add(key);
        tried++;
        const pairs = ordered.map((j, r) => ({ x: stars[j].x, y: stars[j].y, v: cv(cat, band.Q[4 * k + r]) }));
        const f = fitPairs(pairs, m, cx, cy);
        if (!f || f.rms > tolPx) return;
        const sc = scaleDeg(f.sol); if (sc < lo || sc > hi) return;
        const r = verify(cat, band, stars, f.sol, w, h, tolPx, nUse);
        if (r && (!best || r.matched > best.matched)) best = { ...r, band: F };
      });
      if (best?.ok && best.matched >= Math.max(12, 0.5 * nUse)) break;
    }
    if (best?.ok) break;
  }
  const ms = Date.now() - t0;
  if (!best?.ok) return { ok: false, reason: 'no-match', tried, ms, best };
  return { ok: true, ...best, tolPx, tried, ms, ...summary(best.sol, w, h) };
}

// Centre, field of view and orientation of a solution.
export function summary(sol, w, h) {
  const c = pixToSky(sol, w / 2, h / 2);
  const width = sepDeg(...Object.values(pixToSky(sol, 0, h / 2)), ...Object.values(pixToSky(sol, w, h / 2)));
  const height = sepDeg(...Object.values(pixToSky(sol, w / 2, 0)), ...Object.values(pixToSky(sol, w / 2, h)));
  return { centre: c, fovW: width, fovH: height, up: upAngle(sol), mirrored: sol.m < 0 };
}

// "Help me line it up": two clicked stars and their catalogue names -> a solution (proper, not mirrored).
export function fitTwo(cat, p1, i1, p2, i2, w, h) {
  const pairs = [{ x: p1.x, y: p1.y, v: cv(cat, i1) }, { x: p2.x, y: p2.y, v: cv(cat, i2) }];
  if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 10 || i1 === i2) return null;
  const f = fitPairs(pairs, 1, w / 2, h / 2);
  return f && f.sol;
}

// After a 2-star fit: how many other photo stars land on catalogue stars (an honest check), refined if enough.
export function checkTwo(cat, sol, stars, w, h) {
  const tolPx = Math.max(3, 0.008 * Math.hypot(w, h)), area = w * h * scaleDeg(sol) ** 2;
  // a catalogue about 2.5x as dense as the stars we test
  const nUse = Math.min(40, stars.length), want = Math.min(cat.n, Math.round(2.5 * nUse * 41253 / Math.max(area, 1)));
  const idx = []; for (let i = 0; i < want; i++) idx.push(i);
  const band = { grid: skyGrid(cat, idx, 2), density: idx.length / 41253 };
  const r = verify(cat, band, stars, sol, w, h, tolPx, nUse);
  return r ? { ...r, ...summary(r.sol, w, h), tolPx } : null;
}

// Catalogue stars that fall on the photo (for labels): brightest first, up to magLimit.
export function starsInPhoto(cat, sol, w, h, magLimit = 5.5, max = 400) {
  const c = pixToSky(sol, w / 2, h / 2), rad = Math.hypot(w, h) / 2 * scaleDeg(sol) * 1.3, out = [];
  for (let i = 0; i < cat.n && cat.mag[i] <= magLimit && out.length < max; i++) {
    if (sepDeg(cat.ra[i], cat.dec[i], c.ra, c.dec) > rad + 1) continue;
    const p = skyToPix(sol, cat.ra[i], cat.dec[i]);
    if (p && p.x >= 0 && p.y >= 0 && p.x < w && p.y < h) out.push({ i, x: p.x, y: p.y, mag: cat.mag[i], name: starName(cat, i), hip: cat.hip[i] });
  }
  return out;
}
