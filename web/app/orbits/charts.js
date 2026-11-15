// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
import { dateToJulian, rawPosition, BUILT_IN_BY_NAME } from './model.js';

const SVG = 'http://www.w3.org/2000/svg';
export const SERIES = Object.freeze([
  { color: '#FFF6E8', dash: '', marker: 'circle' },
  { color: '#E3A86B', dash: '7 4', marker: 'square' },
  { color: '#9DB8A0', dash: '2 4', marker: 'diamond' },
  { color: '#B5A898', dash: '11 4 2 4', marker: 'triangle' },
  { color: '#FFF6E8', dash: '3 6', marker: 'diamond' },
  { color: '#E3A86B', dash: '12 6', marker: 'triangle' },
]);

function node(name, attributes = {}) {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function orbitPoints(object, nowJd, samples = 180) {
  const period = object.periodDays;
  if (!(period > 0)) return [];
  return Array.from({ length: samples + 1 }, (_, index) => rawPosition(object, nowJd + period * index / samples)).filter(Boolean);
}

function marker(shape, x, y, color, filled, size = 5) {
  const common = { fill: filled ? color : 'none', stroke: color, 'stroke-width': 1.7 };
  if (shape === 'square') return node('rect', { x: x - size, y: y - size, width: size * 2, height: size * 2, ...common });
  if (shape === 'diamond') return node('path', { d: `M${x} ${y - size - 1}L${x + size + 1} ${y}L${x} ${y + size + 1}L${x - size - 1} ${y}Z`, ...common });
  if (shape === 'triangle') return node('path', { d: `M${x} ${y - size - 1}L${x + size + 1} ${y + size}L${x - size - 1} ${y + size}Z`, ...common });
  return node('circle', { cx: x, cy: y, r: size, ...common });
}

// Zoomable orbit diagram (Claude, Anthropic, for team Proper Motion): drawn in screen pixels, so labels keep their size;
// wheel or pinch zooms towards the pointer, drag pans, +/−/Reset keys, and a scale bar in au that follows the zoom.
const ZOOM_MIN = 0.3, ZOOM_MAX = 2000;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function niceAu(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  return [5, 2, 1].map(m => m * p).find(v => v <= raw) || p;
}
const fmtAu = v => (v >= 1 ? String(v) : String(Number(v.toPrecision(1))));

function setupOrbitStage(container) {
  container.replaceChildren();
  container.classList.add('orbit-zoomable');
  const svg = node('svg', { class: 'orbit-svg', role: 'img', tabindex: '0' });
  const keys = document.createElement('div');
  keys.className = 'orbit-zoom-keys';
  keys.setAttribute('role', 'group');
  keys.setAttribute('aria-label', 'Zoom the orbit diagram');
  const st = { svg, view: { z: 1, cx: 0, cy: 0 }, pointers: new Map(), anim: 0 };
  const home = () => animateTo(st, { z: 1, cx: 0, cy: 0 });
  for (const [text, label, act] of [['+', 'Zoom in', () => zoomBy(st, 1.6)], ['−', 'Zoom out', () => zoomBy(st, 1 / 1.6)], ['Reset', 'Reset zoom and pan', home]]) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'key stage-key orbit-zoom-key'; b.textContent = text; b.setAttribute('aria-label', label);
    b.addEventListener('click', act);
    keys.append(b);
  }
  container.append(svg, keys);

  const local = e => { const m = svg.getScreenCTM(); return m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : { x: 0, y: 0 }; };
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    cancelAnimationFrame(st.anim);
    const k = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0015;
    zoomAt(st, local(e), Math.exp(-e.deltaY * k));
  }, { passive: false });
  svg.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelAnimationFrame(st.anim);
    st.pointers.set(e.pointerId, local(e));
    try { svg.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    svg.classList.add('dragging');
  });
  svg.addEventListener('pointermove', e => {
    if (!st.pointers.has(e.pointerId)) return;
    const before = [...st.pointers.values()];
    st.pointers.set(e.pointerId, local(e));
    const after = [...st.pointers.values()];
    if (after.length === 1) { panBy(st, after[0].x - before[0].x, after[0].y - before[0].y); return; }
    const mid = ps => ({ x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 });
    const dist = ps => Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1;
    const m0 = mid(before), m1 = mid(after);
    panBy(st, m1.x - m0.x, m1.y - m0.y, false);
    zoomAt(st, m1, dist(after) / dist(before));
  });
  const end = e => { st.pointers.delete(e.pointerId); if (!st.pointers.size) svg.classList.remove('dragging'); };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('keydown', e => {
    const acts = { '+': () => zoomBy(st, 1.6), '=': () => zoomBy(st, 1.6), '-': () => zoomBy(st, 1 / 1.6), '0': home,
      ArrowLeft: () => panBy(st, 40, 0), ArrowRight: () => panBy(st, -40, 0), ArrowUp: () => panBy(st, 0, 40), ArrowDown: () => panBy(st, 0, -40) };
    if (acts[e.key]) { e.preventDefault(); acts[e.key](); }
  });
  if ('ResizeObserver' in window) new ResizeObserver(() => drawOrbit(st)).observe(svg);
  return st;
}

function size(st) { return { W: st.svg.clientWidth, H: st.svg.clientHeight }; }
function scaleOf(st, W, H, z = st.view.z) { return (Math.min(W, H) / 2 - 34) / st.span * z; }
function clampView(st, v) {
  const lim = Math.max(st.span, st.maxQ) * 1.5;
  return { z: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.z)), cx: Math.min(lim, Math.max(-lim, v.cx)), cy: Math.min(lim, Math.max(-lim, v.cy)) };
}
function setView(st, v) { st.view = clampView(st, v); drawOrbit(st); }
function panBy(st, dx, dy, draw = true) {
  const { W, H } = size(st); if (!W || !H) return;
  const s = scaleOf(st, W, H);
  st.view = clampView(st, { ...st.view, cx: st.view.cx - dx / s, cy: st.view.cy + dy / s });
  if (draw) drawOrbit(st);
}
// Zoom by factor f, keeping the world point under p (diagram px) fixed.
function zoomAt(st, p, f) {
  const { W, H } = size(st); if (!W || !H || !Number.isFinite(f)) return;
  const s0 = scaleOf(st, W, H);
  const wx = st.view.cx + (p.x - W / 2) / s0, wy = st.view.cy - (p.y - H / 2) / s0;
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, st.view.z * f));
  const s1 = scaleOf(st, W, H, z);
  setView(st, { z, cx: wx - (p.x - W / 2) / s1, cy: wy + (p.y - H / 2) / s1 });
}
function zoomBy(st, f) { animateTo(st, { ...st.view, z: st.view.z * f }); }
// A short eased zoom for the keys; none at all with reduced motion.
function animateTo(st, target) {
  cancelAnimationFrame(st.anim);
  target = clampView(st, target);
  if (reduceMotion()) { setView(st, target); return; }
  const from = { ...st.view }, t0 = performance.now(), dur = 200;
  const step = now => {
    const t = Math.min(1, (now - t0) / dur), e = 1 - (1 - t) ** 3;
    const z = Math.exp(Math.log(from.z) + (Math.log(target.z) - Math.log(from.z)) * e);
    setView(st, { z, cx: from.cx + (target.cx - from.cx) * e, cy: from.cy + (target.cy - from.cy) * e });
    if (t < 1) st.anim = requestAnimationFrame(step);
  };
  st.anim = requestAnimationFrame(step);
}

export function renderOrbitPlot(container, objects, { mode = 'inner', now = new Date(), selectedId = null } = {}) {
  const st = container._orbit || (container._orbit = setupOrbitStage(container));
  const earth = BUILT_IN_BY_NAME.get('earth');
  const plotted = objects.some(item => item.id === earth.id) ? objects : [earth, ...objects];
  const maxQ = Math.max(1.1, ...plotted.map(item => item.centralBody === 'Earth' ? 1.01 : (item.aAu || 0) * (1 + (item.eccentricity || 0))));
  const span = mode === 'inner' ? 2.2 : maxQ * 1.12;
  if (st.mode !== mode || st.span !== span || st.resetNext) { cancelAnimationFrame(st.anim); st.view = { z: 1, cx: 0, cy: 0 }; st.resetNext = false; }
  Object.assign(st, { mode, span, maxQ, earth, objects, jd: dateToJulian(now), selectedId });
  st.svg.setAttribute('aria-label', `Top-down orbital paths, ${mode === 'inner' ? 'inner Solar System' : 'fit all selected objects'}. Wheel or pinch to zoom, drag to pan.`);
  drawOrbit(st);
}
// The Inner system / Fit all keys reset the zoom even when the mode is unchanged.
export function resetOrbitView(container) { if (container._orbit) container._orbit.resetNext = true; }

function drawOrbit(st) {
  const { svg } = st;
  const { W, H } = size(st);
  if (!W || !H || !st.earth) return;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();
  const s = scaleOf(st, W, H), { cx: vx, cy: vy } = st.view;
  const x = value => W / 2 + (value - vx) * s;
  const y = value => H / 2 - (value - vy) * s;
  const sx = x(0), sy = y(0);
  const inView = (px, py, m = 20) => px > -m && px < W + m && py > -m && py < H + m;
  const pathOf = points => points.map((point, index) => `${index ? 'L' : 'M'}${x(point.x).toFixed(1)} ${y(point.y).toFixed(1)}`).join(' ');

  const reach = Math.max(st.span, st.maxQ) * 1.2;
  let nextLabelX = sx + 48; // ring labels sit on one line: skip any that would overlap the Sun's or the previous one
  for (const radius of [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 50]) {
    const r = radius * s;
    if (radius > reach || r < 22 || r > 6 * Math.max(W, H)) continue;
    svg.append(node('circle', { cx: sx, cy: sy, r, fill: 'none', class: radius === 1 ? 'earth-guide' : 'orbit-grid' }));
    if (sx + r + 5 >= nextLabelX && inView(sx + r + 5, sy - 5, 0)) {
      nextLabelX = sx + r + 5 + 52;
      const label = node('text', { x: sx + r + 5, y: sy - 5, class: 'chart-label' });
      label.textContent = `${fmtAu(radius)} au`;
      svg.append(label);
    }
  }

  svg.append(node('path', { d: pathOf(orbitPoints(st.earth, st.jd)), class: 'planet-orbit' }));

  st.objects.forEach((object, index) => {
    const style = SERIES[index % SERIES.length];
    const points = orbitPoints(object, st.jd);
    if (!points.length) return;
    const path = node('path', { d: pathOf(points), fill: 'none', stroke: style.color, 'stroke-width': 1.5, 'stroke-dasharray': style.dash, class: 'object-orbit' });
    path.append(node('title'));
    path.firstChild.textContent = `${object.name} orbit · ${object.source}`;
    svg.append(path);
    const current = rawPosition(object, st.jd);
    if (current && inView(x(current.x), y(current.y))) {
      svg.append(marker(style.marker, x(current.x), y(current.y), style.color, object.id === st.selectedId, 4.5));
      const label = node('text', { x: x(current.x) + 8, y: y(current.y) - 8, fill: style.color, class: 'orbit-name' });
      label.textContent = object.name;
      svg.append(label);
    }
  });

  if (inView(sx, sy)) {
    svg.append(node('circle', { cx: sx, cy: sy, r: 5, class: 'sun-mark' }));
    const sun = node('text', { x: sx + 10, y: sy + 4, class: 'orbit-name sun-name' });
    sun.textContent = 'Sun';
    svg.append(sun);
  }
  const barAu = niceAu(Math.min(140, W * 0.3) / s);
  const barY = H - 18, barX = 16;
  svg.append(node('rect', { x: barX - 8, y: barY - 26, width: Math.max(barAu * s, 56) + 16, height: 34, rx: 6, class: 'scale-back' }));
  svg.append(node('line', { x1: barX, y1: barY, x2: barX + barAu * s, y2: barY, class: 'scale-bar' }));
  const scaleLabel = node('text', { x: barX, y: barY - 8, class: 'chart-label scale-label' });
  scaleLabel.textContent = `${fmtAu(barAu)} au`;
  svg.append(scaleLabel);
}

function scaleFor(values, start, end, logarithmic) {
  const usable = values.filter(Number.isFinite).filter(value => !logarithmic || value > 0);
  if (!usable.length) return null;
  const transformed = usable.map(value => logarithmic ? Math.log10(value) : value);
  let min = Math.min(...transformed), max = Math.max(...transformed);
  if (min === max) { min -= 0.5; max += 0.5; }
  const pad = (max - min) * 0.08;
  min -= pad; max += pad;
  const map = value => {
    if (!Number.isFinite(value) || (logarithmic && value <= 0)) return null;
    const current = logarithmic ? Math.log10(value) : value;
    return start + (current - min) / (max - min) * (end - start);
  };
  return { map, min, max, logarithmic };
}

function tickValue(scale, fraction) {
  const transformed = scale.min + (scale.max - scale.min) * fraction;
  return scale.logarithmic ? 10 ** transformed : transformed;
}

function shortNumber(value) {
  const magnitude = Math.abs(value);
  if ((magnitude > 0 && magnitude < 0.001) || magnitude >= 10_000) return value.toExponential(1);
  return Number(value.toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

export function renderScatter(container, objects, { xKey, yKey, xLabel, yLabel, xLog = false, yLog = false, selectedId = null }) {
  container.replaceChildren();
  const width = 920, height = 430, margin = { top: 24, right: 34, bottom: 58, left: 72 };
  const xScale = scaleFor(objects.map(item => item[xKey]), margin.left, width - margin.right, xLog);
  const yScale = scaleFor(objects.map(item => item[yKey]), height - margin.bottom, margin.top, yLog);
  if (!xScale || !yScale) {
    container.textContent = 'The selected variables do not have enough numeric values to plot.';
    return;
  }
  const svg = node('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${yLabel} against ${xLabel}` });
  for (let index = 0; index <= 4; index += 1) {
    const fraction = index / 4;
    const xx = margin.left + (width - margin.left - margin.right) * fraction;
    const yy = margin.top + (height - margin.top - margin.bottom) * fraction;
    svg.append(node('line', { x1: xx, y1: margin.top, x2: xx, y2: height - margin.bottom, class: 'chart-grid' }));
    svg.append(node('line', { x1: margin.left, y1: yy, x2: width - margin.right, y2: yy, class: 'chart-grid' }));
    const xTick = node('text', { x: xx, y: height - margin.bottom + 20, 'text-anchor': 'middle', class: 'chart-label' });
    xTick.textContent = shortNumber(tickValue(xScale, fraction));
    svg.append(xTick);
    const yTick = node('text', { x: margin.left - 10, y: yy + 4, 'text-anchor': 'end', class: 'chart-label' });
    yTick.textContent = shortNumber(tickValue(yScale, 1 - fraction));
    svg.append(yTick);
  }
  objects.forEach((object, index) => {
    const xx = xScale.map(object[xKey]), yy = yScale.map(object[yKey]);
    if (xx === null || yy === null) return;
    const style = SERIES[index % SERIES.length];
    const point = marker(style.marker, xx, yy, style.color, object.id === selectedId, 6);
    const title = node('title');
    title.textContent = `${object.name}\n${xLabel}: ${object[xKey]}\n${yLabel}: ${object[yKey]}\n${object.source}`;
    point.append(title);
    svg.append(point);
    const label = node('text', { x: xx + 10, y: yy - 9, fill: style.color, class: 'orbit-name' });
    label.textContent = object.name;
    svg.append(label);
  });
  const xTitle = node('text', { x: (margin.left + width - margin.right) / 2, y: height - 14, 'text-anchor': 'middle', class: 'chart-label axis-title' });
  xTitle.textContent = `${xLabel}${xLog ? ' · log' : ''}`;
  svg.append(xTitle);
  const yTitle = node('text', { x: 18, y: height / 2, transform: `rotate(-90 18 ${height / 2})`, 'text-anchor': 'middle', class: 'chart-label axis-title' });
  yTitle.textContent = `${yLabel}${yLog ? ' · log' : ''}`;
  svg.append(yTitle);
  container.append(svg);
}
