// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026

const SVG = 'http://www.w3.org/2000/svg';

function node(name, attributes = {}) {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

export function renderDistanceTimeline(container, approaches, selectedId = null) {
  container.replaceChildren();
  const rows = approaches.filter(item => item.date && item.distanceLd > 0).sort((a, b) => a.date - b.date);
  if (!rows.length) {
    container.textContent = 'No close-approach points are available for this interval.';
    return;
  }

  const width = 920, height = 330;
  const margin = { top: 26, right: 30, bottom: 50, left: 68 };
  const minTime = rows[0].date.valueOf(), maxTime = rows.at(-1).date.valueOf();
  const minLd = Math.max(0.01, Math.min(...rows.map(item => item.distanceLd)) / 1.35);
  const maxLd = Math.max(20, Math.max(...rows.map(item => item.distanceLd)) * 1.35);
  const x = date => margin.left + (date.valueOf() - minTime) / Math.max(1, maxTime - minTime) * (width - margin.left - margin.right);
  const y = ld => margin.top + (Math.log10(maxLd) - Math.log10(ld)) / (Math.log10(maxLd) - Math.log10(minLd)) * (height - margin.top - margin.bottom);
  const svg = node('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Close approaches over time on a logarithmic lunar-distance scale' });

  const ticks = [0.1, 1, 10, 20].filter(value => value >= minLd && value <= maxLd);
  for (const value of ticks) {
    const yy = y(value);
    svg.append(node('line', { x1: margin.left, y1: yy, x2: width - margin.right, y2: yy, class: value === 1 ? 'moon-line' : 'chart-grid' }));
    const label = node('text', { x: margin.left - 10, y: yy + 4, 'text-anchor': 'end', class: 'chart-label' });
    label.textContent = value === 1 ? 'Moon · 1 LD' : `${value} LD`;
    svg.append(label);
  }

  const dateTicks = 4;
  for (let index = 0; index <= dateTicks; index += 1) {
    const value = new Date(minTime + (maxTime - minTime) * index / dateTicks);
    const xx = x(value);
    svg.append(node('line', { x1: xx, y1: margin.top, x2: xx, y2: height - margin.bottom, class: 'chart-grid' }));
    const label = node('text', { x: xx, y: height - 20, 'text-anchor': 'middle', class: 'chart-label' });
    label.textContent = value.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    svg.append(label);
  }

  for (const item of rows) {
    const point = node('g', { class: `timeline-point ${item.id === selectedId ? 'selected' : ''}`, tabindex: '0', role: 'button', 'aria-label': `${item.name}, ${item.distanceLd.toFixed(2)} lunar distances` });
    point.dataset.id = item.id;
    point.append(node('circle', { cx: x(item.date), cy: y(item.distanceLd), r: item.id === selectedId ? 5 : 4 }));
    const title = node('title');
    title.textContent = `${item.name}\n${item.distanceLd.toFixed(2)} LD · ${Math.round(item.distanceKm).toLocaleString('en-US')} km\n${item.date.toISOString().slice(0, 16).replace('T', ' ')} UTC · JPL`;
    point.append(title);
    svg.append(point);
  }

  const axisTitle = node('text', { x: 16, y: height / 2, transform: `rotate(-90 16 ${height / 2})`, 'text-anchor': 'middle', class: 'chart-label axis-title' });
  axisTitle.textContent = 'Distance from Earth · log scale';
  svg.append(axisTitle);
  container.append(svg);
}

