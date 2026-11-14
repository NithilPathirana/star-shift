// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Canvas 2D drawing of the horizon sky (DESIGN.md sections 18 and 26): flat dark stage,
// alt-az grid, Hipparcos stars, flat ground, horizon line with N/E/S/W, Sun, Moon with its
// real phase, planets and (hook) small bodies. Draws only when something changed.
import { makeView, project, magLimit } from './projection.js';
import { altAzToVec } from './astro.js';

const C = {
  stage: '#15110E', ground: '#1B1612', horizon: 'rgba(255,246,232,.40)', grid: 'rgba(255,235,210,.08)',
  gridStrong: 'rgba(255,235,210,.14)', text: '#EDE5DA', muted: '#B5A898', ivory: '#FFF6E8', ring: '#E3A86B',
};
const MONO = '"IBM Plex Mono", ui-monospace, monospace', SANS = '"Instrument Sans", system-ui, sans-serif';

// Project ignoring the behind-the-viewer cut (for the horizon circle fit).
function projRaw(v, x, y, z) {
  const Z = x * v.d[0] + y * v.d[1] + z * v.d[2], k = 2 / Math.max(1e-6, 1 + Z) * v.scale;
  return [v.cx + k * (x * v.r[0] + y * v.r[1] + z * v.r[2]), v.cy - k * (x * v.u[0] + y * v.u[1] + z * v.u[2])];
}

// The horizon is a great circle; stereographic projection maps it to a circle or a line.
function groundPath(ctx, v) {
  const pts = [-90, 0, 90].map(da => projRaw(v, ...altAzToVec(0, v.az + da)));
  const below = projRaw(v, ...altAzToVec(-45, v.az)); // a point that is surely on the ground
  const [[x1, y1], [x2, y2], [x3, y3]] = pts;
  const dd = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  ctx.beginPath();
  if (Math.abs(dd) < 1e-6 * v.scale * v.scale) { // a straight line through pts[0] and pts[2]
    const dx = x3 - x1, dy = y3 - y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    const side = Math.sign((below[0] - x1) * nx + (below[1] - y1) * ny) || 1, big = 1e5;
    ctx.moveTo(x1 - dx / L * big, y1 - dy / L * big); ctx.lineTo(x1 + dx / L * big, y1 + dy / L * big);
    ctx.lineTo(x1 + dx / L * big + nx * side * big, y1 + dy / L * big + ny * side * big);
    ctx.lineTo(x1 - dx / L * big + nx * side * big, y1 - dy / L * big + ny * side * big);
    ctx.closePath();
    return { line: [x1, y1, x3, y3] };
  }
  const s1 = x1 * x1 + y1 * y1, s2 = x2 * x2 + y2 * y2, s3 = x3 * x3 + y3 * y3;
  const cx = (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / dd, cy = (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / dd;
  const R = Math.hypot(x1 - cx, y1 - cy), inside = Math.hypot(below[0] - cx, below[1] - cy) < R;
  if (inside) ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  else { ctx.rect(-10, -10, v.w + 20, v.h + 20); ctx.arc(cx, cy, R, 0, 2 * Math.PI, true); }
  return { circle: [cx, cy, R], inside };
}

function strokeCurve(ctx, v, pts) { // pts: array of [e,n,u]; breaks where points go behind
  let pen = false; const p = [0, 0];
  for (const q of pts) {
    if (!project(v, q[0], q[1], q[2], p) || Math.abs(p[0]) > 4 * v.w + 2000 || Math.abs(p[1]) > 4 * v.h + 2000) { pen = false; continue; }
    if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; }
  }
}

function drawGrid(ctx, v) {
  ctx.lineWidth = 1; ctx.strokeStyle = C.grid; ctx.beginPath();
  const step = v.fov > 60 ? 30 : v.fov > 20 ? 15 : v.fov > 6 ? 5 : 1;
  for (let az = 0; az < 360; az += step) { // azimuth lines from the horizon to near the zenith
    const pts = []; for (let alt = 0; alt <= 90 - step / 2; alt += 2) pts.push(altAzToVec(alt, az));
    strokeCurve(ctx, v, pts);
  }
  const astep = v.fov > 20 ? 10 : v.fov > 6 ? 5 : 1;
  for (let alt = astep; alt < 90; alt += astep) {
    const pts = []; for (let az = 0; az <= 360; az += 2) pts.push(altAzToVec(alt, az));
    strokeCurve(ctx, v, pts);
  }
  ctx.stroke();
  // altitude numbers along the azimuth the view faces
  ctx.font = `11px ${MONO}`; ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.globalAlpha = 0.55;
  const p = [0, 0];
  for (let alt = 30; alt < 90; alt += 30) if (project(v, ...altAzToVec(alt, v.az), p)) ctx.fillText(alt + '°', p[0] + 4, p[1] - 7);
  ctx.globalAlpha = 1;
}

const CARD = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
function drawHorizon(ctx, v, g) {
  ctx.strokeStyle = C.horizon; ctx.lineWidth = 1; ctx.beginPath();
  if (g.line) { const [x1, y1, x3, y3] = g.line, dx = x3 - x1, dy = y3 - y1; ctx.moveTo(x1 - dx * 1e3, y1 - dy * 1e3); ctx.lineTo(x1 + dx * 1e3, y1 + dy * 1e3); }
  else ctx.arc(g.circle[0], g.circle[1], g.circle[2], 0, 2 * Math.PI);
  ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; const p = [0, 0];
  for (const [t, az] of CARD) {
    if (!project(v, ...altAzToVec(0, az), p) || p[0] < -20 || p[0] > v.w + 20 || p[1] < -20 || p[1] > v.h + 20) continue;
    const main = t.length === 1;
    ctx.font = `${main ? 600 : 400} ${main ? 13 : 11}px ${MONO}`; ctx.fillStyle = main ? C.text : C.muted;
    ctx.fillText(t, p[0], p[1] + 6);
  }
}

function drawStars(ctx, v, S, opt, picks) {
  const lim = magLimit(v.fov), p = [0, 0], hor = S.hor, n = S.mag.length;
  const fade = opt.belowAlpha;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const m = S.mag[i]; if (m > lim) continue;
    const u = hor[3 * i + 2]; if (u < 0 && !opt.below) continue;
    if (!project(v, hor[3 * i], hor[3 * i + 1], u, p)) continue;
    const x = p[0], y = p[1]; if (x < -8 || y < -8 || x > v.w + 8 || y > v.h + 8) continue;
    const size = S.size[i], a = S.alpha[i] * (u < 0 ? fade : 1) * opt.starDim;
    ctx.globalAlpha = a; ctx.fillStyle = S.color[i];
    if (size < 2.2) ctx.fillRect(x - size / 2, y - size / 2, size, size);
    else {
      if (m < 2 && u >= 0) { // soft radial halo (35% to 0) so it never reads as a selection ring
        const R = size * 1.8, g = ctx.createRadialGradient(x, y, size / 2, x, y, R);
        g.addColorStop(0, S.color[i]); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = a * 0.35; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = a; ctx.fillStyle = S.color[i];
      }
      ctx.beginPath(); ctx.arc(x, y, size / 2, 0, 6.2832); ctx.fill();
    }
    if (picks.n < picks.x.length) { picks.x[picks.n] = x; picks.y[picks.n] = y; picks.i[picks.n] = i; picks.n++; }
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

// Place a label next to a mark without overlapping earlier labels (tries a few offsets).
function placeLabel(ctx, text, x, y, rects, force) {
  const w = ctx.measureText(text).width, h = 14;
  for (const dy of [0, 13, -13, 26]) {
    const r = [x, y + dy - h / 2, x + w, y + dy + h / 2];
    if (!rects.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) { rects.push(r); ctx.fillText(text, x, y + dy); return true; }
  }
  if (force) { ctx.fillText(text, x, y); rects.push([x, y - h / 2, x + w, y + h / 2]); }
  return false;
}

// keep: label rects of Solar System objects; a star name within 24 px of one is hidden (the planet's label wins)
function drawStarLabels(ctx, v, S, rects, keep = []) {
  const blk = [...rects, ...keep.map(q => [q[0] - 24, q[1] - 24, q[2] + 24, q[3] + 24])]; // star labels also avoid each other
  const lim = Math.min(2.2 + Math.max(0, Math.log2(90 / v.fov)) * 1.2, 6), p = [0, 0];
  ctx.font = `12px ${SANS}`; ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const i of S.named) {
    if (S.mag[i] > lim) continue;
    const u = S.hor[3 * i + 2]; if (u < 0) continue;
    if (!project(v, S.hor[3 * i], S.hor[3 * i + 1], u, p) || p[0] < 0 || p[1] < 0 || p[0] > v.w || p[1] > v.h) continue;
    placeLabel(ctx, S.names.get(i), p[0] + S.size[i] / 2 + 5, p[1], blk, false);
  }
}

// Moon with its real phase: lit half-disc towards the Sun plus the terminator half-ellipse.
function drawMoon(ctx, x, y, r, k, ang) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = 'rgba(255,246,232,.16)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832); ctx.fill();
  ctx.fillStyle = C.ivory; ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  const rx = r * Math.abs(2 * k - 1);
  if (k >= 0.5) ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, 3 * Math.PI / 2, false);
  else ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, -Math.PI / 2, true);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,246,232,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832); ctx.stroke();
  ctx.restore();
}

function drawBodies(ctx, v, list, opt, picks, rects) {
  const p = [0, 0], sun = list.find(b => b.kind === 'sun');
  const order = [...list].sort((a, b) => (b.mag ?? 99) - (a.mag ?? 99)); // bright ones on top
  for (const b of order) {
    const vec = altAzToVec(b.alt, b.az);
    if (b.alt < 0 && !opt.below) continue;
    if (!project(v, vec[0], vec[1], vec[2], p)) continue;
    const x = p[0], y = p[1]; if (x < -30 || y < -30 || x > v.w + 30 || y > v.h + 30) continue;
    ctx.globalAlpha = b.alt < 0 ? opt.belowAlpha : 1;
    let r = 3, label = b.name;
    if (b.kind === 'sun') {
      r = 7; ctx.fillStyle = C.ivory; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = C.ivory; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 6.2832); ctx.stroke(); r += 4;
    } else if (b.kind === 'moon') {
      r = 8; let ang = 0;
      if (sun) { // screen direction from the Moon towards the Sun along the sky
        const s = altAzToVec(sun.alt, sun.az), dot = s[0] * vec[0] + s[1] * vec[1] + s[2] * vec[2];
        const t = [s[0] - dot * vec[0], s[1] - dot * vec[1], s[2] - dot * vec[2]], L = Math.hypot(...t) || 1, e = 0.01;
        const q = project(v, vec[0] + t[0] / L * e, vec[1] + t[1] / L * e, vec[2] + t[2] / L * e, [0, 0]);
        if (q) ang = Math.atan2(q[1] - y, q[0] - x);
      }
      drawMoon(ctx, x, y, r, b.phase ?? 0.5, ang);
      if (Number.isFinite(b.phase)) label = `Moon · ${Math.round(b.phase * 100)}% lit`;
    } else if (b.kind === 'small') {
      ctx.strokeStyle = C.ivory; ctx.lineWidth = 1.3; ctx.beginPath();
      ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 4); ctx.lineTo(x - 4, y); ctx.closePath(); ctx.stroke(); r = 4;
    } else { ctx.fillStyle = C.ivory; ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.2832); ctx.fill(); }
    if (opt.labels) {
      ctx.font = `600 12px ${SANS}`; ctx.fillStyle = C.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      placeLabel(ctx, label, x + r + 6, y, rects, true);
    }
    ctx.globalAlpha = 1;
    picks.bodies.push({ x, y, r: r + 6, b });
  }
}

// Selected object: the section 19 reticle in its snapped state (40 px solid copper ring + four 6 px ticks).
function drawSelection(ctx, v, sel) {
  if (!sel) return;
  const vec = altAzToVec(sel.alt, sel.az), p = project(v, vec[0], vec[1], vec[2], [0, 0]);
  if (!p) return;
  const [x, y] = p, r = 20;
  ctx.strokeStyle = '#C27A43'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832);
  ctx.moveTo(x, y - r - 2); ctx.lineTo(x, y - r - 8); ctx.moveTo(x, y + r + 2); ctx.lineTo(x, y + r + 8);
  ctx.moveTo(x - r - 2, y); ctx.lineTo(x - r - 8, y); ctx.moveTo(x + r + 2, y); ctx.lineTo(x + r + 8, y);
  ctx.stroke();
}

// state: { view:{az,alt,fov}, w, h, dpr, stars:S, bodies:[], small:[], sel, opt }
// Returns picks for hover/click hit-testing.
export function draw(ctx, st) {
  const v = makeView({ ...st.view, w: st.w, h: st.h });
  ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
  ctx.fillStyle = C.stage; ctx.fillRect(0, 0, st.w, st.h);
  const picks = st.picks || { x: new Float32Array(16000), y: new Float32Array(16000), i: new Int32Array(16000), n: 0, bodies: [] };
  picks.n = 0; picks.bodies = []; picks.view = v;
  const opt = { below: st.opt.below, belowAlpha: 0.35, labels: st.opt.labels, starDim: 1 };
  if (st.opt.grid) drawGrid(ctx, v);
  // stars above the horizon, then the ground covers anything below it
  if (st.stars) drawStars(ctx, v, st.stars, { ...opt, below: false }, picks);
  ctx.fillStyle = C.ground; const g = groundPath(ctx, v); ctx.fill('evenodd');
  if (st.opt.below && st.stars) drawStarsBelow(ctx, v, st.stars, opt, picks); // at 35%
  drawHorizon(ctx, v, g);
  const rects = st.avoid ? st.avoid.map(r => [...r]) : []; // screen areas covered by chips
  const n0 = rects.length;
  drawBodies(ctx, v, [...(st.bodies || []), ...(st.small || [])], opt, picks, rects);
  if (st.stars && st.opt.labels) drawStarLabels(ctx, v, st.stars, rects, rects.slice(n0));
  drawSelection(ctx, v, st.sel);
  return picks;
}

function drawStarsBelow(ctx, v, S, opt, picks) {
  const lim = Math.min(magLimit(v.fov), 5.5), p = [0, 0], hor = S.hor;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < S.mag.length; i++) {
    if (S.mag[i] > lim) continue; const u = hor[3 * i + 2]; if (u >= 0) continue;
    if (!project(v, hor[3 * i], hor[3 * i + 1], u, p) || p[0] < -8 || p[1] < -8 || p[0] > v.w + 8 || p[1] > v.h + 8) continue;
    const s = S.size[i]; ctx.globalAlpha = S.alpha[i] * opt.belowAlpha; ctx.fillStyle = S.color[i];
    ctx.fillRect(p[0] - s / 2, p[1] - s / 2, s, s);
    if (picks.n < picks.x.length) { picks.x[picks.n] = p[0]; picks.y[picks.n] = p[1]; picks.i[picks.n] = i; picks.n++; }
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

