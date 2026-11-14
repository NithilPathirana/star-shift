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

export function renderOrbitPlot(container, objects, { mode = 'inner', now = new Date(), selectedId = null } = {}) {
  container.replaceChildren();
  const width = 920, height = 520, cx = width / 2, cy = height / 2;
  const earth = BUILT_IN_BY_NAME.get('earth');
  const plotted = objects.some(item => item.id === earth.id) ? objects : [earth, ...objects];
  const maxQ = Math.max(1.1, ...plotted.map(item => item.centralBody === 'Earth' ? 1.01 : (item.aAu || 0) * (1 + (item.eccentricity || 0))));
  const span = mode === 'inner' ? 2.2 : maxQ * 1.12;
  const scale = (Math.min(width, height) / 2 - 34) / span;
  const x = value => cx + value * scale;
  const y = value => cy - value * scale;
  const jd = dateToJulian(now);
  const svg = node('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Top-down orbital paths, ${mode === 'inner' ? 'inner Solar System' : 'fit all selected objects'}` });

  for (const radius of [0.5, 1, 2, 5, 10, 20, 30].filter(value => value < span)) {
    svg.append(node('circle', { cx, cy, r: radius * scale, class: radius === 1 ? 'earth-guide' : 'orbit-grid' }));
    const label = node('text', { x: cx + radius * scale + 5, y: cy - 5, class: 'chart-label' });
    label.textContent = `${radius} au`;
    svg.append(label);
  }

  const earthPath = orbitPoints(earth, jd);
  svg.append(node('path', { d: earthPath.map((point, index) => `${index ? 'L' : 'M'}${x(point.x).toFixed(2)} ${y(point.y).toFixed(2)}`).join(' '), class: 'planet-orbit' }));

  objects.forEach((object, index) => {
    const style = SERIES[index % SERIES.length];
    const points = orbitPoints(object, jd);
    if (!points.length) return;
    const path = node('path', {
      d: points.map((point, pointIndex) => `${pointIndex ? 'L' : 'M'}${x(point.x).toFixed(2)} ${y(point.y).toFixed(2)}`).join(' '),
      fill: 'none', stroke: style.color, 'stroke-width': 1.5, 'stroke-dasharray': style.dash,
      class: 'object-orbit',
    });
    path.append(node('title'));
    path.firstChild.textContent = `${object.name} orbit · ${object.source}`;
    svg.append(path);
    const current = rawPosition(object, jd);
    if (current && Math.abs(current.x) <= span * 1.1 && Math.abs(current.y) <= span * 1.1) {
      svg.append(marker(style.marker, x(current.x), y(current.y), style.color, object.id === selectedId, 4.5));
      const label = node('text', { x: x(current.x) + 8, y: y(current.y) - 8, fill: style.color, class: 'orbit-name' });
      label.textContent = object.name;
      svg.append(label);
    }
  });

  svg.append(node('circle', { cx, cy, r: 5, class: 'sun-mark' }));
  const sun = node('text', { x: cx + 10, y: cy + 4, class: 'orbit-name sun-name' });
  sun.textContent = 'Sun';
  svg.append(sun);
  const barAu = span > 12 ? 5 : span > 4 ? 1 : 0.5;
  const barY = height - 24;
  svg.append(node('line', { x1: 28, y1: barY, x2: 28 + barAu * scale, y2: barY, class: 'scale-bar' }));
  const scaleLabel = node('text', { x: 28, y: barY - 8, class: 'chart-label' });
  scaleLabel.textContent = `${barAu} au`;
  svg.append(scaleLabel);
  container.append(svg);
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
