// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
import { AU_KM } from './kepler.js';
import { BUILT_IN_BY_NAME, deriveObject, findBuiltIn, objectFromSbdb } from './model.js';
import { renderOrbitPlot, renderScatter, SERIES } from './charts.js';

const $ = id => document.getElementById(id);
const LD_KM = 384_400;
const now = new Date();
const state = {
  objects: [deriveObject(findBuiltIn('Earth'), now), deriveObject(findBuiltIn('Mars'), now)],
  selectedId: 'builtin-earth', orbitMode: 'inner', orderKey: 'aAu', xKey: 'aAu',
  yKey: 'eccentricity', xLog: false, yLog: false,
};

const fmt = (value, digits = 4) => value === null || !Number.isFinite(value)
  ? null
  : Number(value.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 9 });

const utcDate = date => date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

const METRICS = Object.freeze([
  { key: 'aAu', label: 'Semi-major axis a', unit: 'au', tag: 'JPL', reason: 'No elliptic semi-major axis is available', format: value => `${fmt(value, 6)} au` },
  { key: 'eccentricity', label: 'Eccentricity e', unit: '', tag: 'JPL', reason: 'No eccentricity is available', format: value => fmt(value, 6) },
  { key: 'inclinationDeg', label: 'Inclination i', unit: '°', tag: 'JPL', reason: 'No inclination is available', format: value => `${fmt(value, 5)}°` },
  { key: 'nodeDeg', label: 'Longitude of node Ω', unit: '°', tag: 'JPL', reason: 'No ascending-node longitude is available', format: value => `${fmt(value, 5)}°` },
  { key: 'argPerihelionDeg', label: 'Argument of perihelion ω', unit: '°', tag: 'JPL', reason: 'No argument of perihelion is available', format: value => `${fmt(value, 5)}°` },
  { key: 'periodYears', label: 'Orbital period P', unit: 'years', tag: 'JPL', reason: 'No orbital period is available', format: value => `${fmt(value, 5)} yr` },
  { key: 'qAu', label: 'Perihelion q', unit: 'au', tag: 'COMPUTED', reason: 'a or e is unavailable', format: value => `${fmt(value, 6)} au` },
  { key: 'aphelionAu', label: 'Aphelion Q', unit: 'au', tag: 'COMPUTED', reason: 'a or e is unavailable', format: value => `${fmt(value, 6)} au` },
  { key: 'moidAu', label: 'Earth MOID', unit: 'au · LD', tag: 'JPL', reason: 'MOID is not reported or is not applicable', format: (value, object) => `${fmt(value, 6)} au · ${fmt(object.moidLd, 4)} LD` },
  { key: 'h', label: 'Absolute magnitude H', unit: 'mag', tag: 'JPL', reason: 'H is not reported or is not applicable', format: value => `${fmt(value, 5)} mag` },
  { key: 'diameterKm', label: 'Diameter', unit: 'km', tag: 'JPL', reason: 'No diameter is available', format: value => `${fmt(value, 6)} km` },
  { key: 'albedo', label: 'Geometric albedo', unit: '', tag: 'JPL', reason: 'No geometric albedo is available', format: value => fmt(value, 5) },
  { key: 'rotationHours', label: 'Rotation period', unit: 'hours', tag: 'JPL', reason: 'No rotation period is available', format: value => `${fmt(value, 6)} h` },
  { key: 'currentSunDistanceAu', label: 'Current distance from Sun', unit: 'au', tag: 'COMPUTED', reason: 'A current position could not be computed', format: value => `${fmt(value, 6)} au` },
  { key: 'currentEarthDistanceAu', label: 'Current distance from Earth', unit: 'au', tag: 'COMPUTED', reason: 'A current position could not be computed', format: value => `${fmt(value, 6)} au` },
  { key: 'currentSpeedKms', label: 'Current heliocentric speed', unit: 'km/s', tag: 'COMPUTED', reason: 'Vis-viva speed could not be computed', format: value => `${fmt(value, 6)} km/s` },
  { key: 'meanSpeedKms', label: 'Mean orbital speed', unit: 'km/s', tag: 'COMPUTED', reason: 'The orbit is incomplete', format: value => `${fmt(value, 6)} km/s` },
  { key: 'nextApproach', label: 'Next Earth close approach', unit: 'UTC · LD', tag: 'JPL', reason: 'No future sufficiently certain Earth approach was returned', numeric: object => object.nextEarthApproach?.date?.valueOf() ?? null, format: (_, object) => `${utcDate(object.nextEarthApproach.date)} · ${fmt(object.nextEarthApproach.distanceAu * AU_KM / LD_KM, 5)} LD` },
  { key: 'orbitClass', label: 'Orbit class', unit: '', tag: 'JPL', reason: 'No orbit class is available', text: true, format: value => value },
]);

const SCATTER_METRICS = METRICS.filter(metric => !metric.text && metric.key !== 'nextApproach');

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setStatus(message, isError = false, children = []) {
  const status = $('orbit-status');
  status.replaceChildren(document.createTextNode(message));
  status.classList.toggle('error', isError);
  for (const child of children) status.append(child);
}

function metricValue(metric, object) {
  return metric.numeric ? metric.numeric(object) : object[metric.key];
}

function missing(reason) {
  const span = element('span', 'missing', '—');
  span.title = reason;
  span.setAttribute('aria-label', `Unavailable: ${reason}`);
  return span;
}

function orderedObjects() {
  const metric = METRICS.find(item => item.key === state.orderKey) || METRICS[0];
  return [...state.objects].sort((left, right) => {
    const a = metricValue(metric, left), b = metricValue(metric, right);
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    return typeof a === 'string' ? a.localeCompare(b) : a - b;
  });
}

function renderSelection() {
  const wrap = $('selected-objects');
  wrap.replaceChildren();
  state.objects.forEach((object, index) => {
    const chip = element('div', `object-chip ${object.id === state.selectedId ? 'selected' : ''}`);
    chip.style.setProperty('--series-color', SERIES[index].color);
    const choose = element('button', 'chip-select', object.name);
    choose.type = 'button';
    choose.setAttribute('aria-pressed', String(object.id === state.selectedId));
    choose.addEventListener('click', () => { state.selectedId = object.id; renderAll(); });
    const remove = element('button', 'remove', '×');
    remove.type = 'button';
    remove.disabled = state.objects.length <= 2;
    remove.setAttribute('aria-label', `Remove ${object.name}`);
    remove.addEventListener('click', () => removeObject(object.id));
    chip.append(choose, remove);
    wrap.append(chip);
  });
  $('selection-count').textContent = `${state.objects.length} / 6`;
}

function renderComparison() {
  const table = $('comparison-table');
  const objects = orderedObjects();
  const headRow = element('tr');
  headRow.append(element('th', '', 'Variable'));
  objects.forEach(object => {
    const index = state.objects.findIndex(item => item.id === object.id);
    const header = element('th', 'object-head', object.name);
    header.scope = 'col';
    header.style.setProperty('--series-color', SERIES[index].color);
    headRow.append(header);
  });
  table.tHead.replaceChildren(headRow);
  table.tBodies[0].replaceChildren();

  for (const metric of METRICS) {
    const row = element('tr');
    const name = element('th', 'metric-name');
    name.scope = 'row';
    name.append(element('span', '', metric.label));
    name.append(element('small', '', metric.unit || 'unitless'));
    row.append(name);
    const values = objects.map(object => metricValue(metric, object));
    const numericValues = metric.text ? [] : values.filter(Number.isFinite);
    const min = numericValues.length > 1 ? Math.min(...numericValues) : null;
    const max = numericValues.length > 1 ? Math.max(...numericValues) : null;
    objects.forEach((object, index) => {
      const value = values[index];
      const cell = element('td', 'num');
      if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
        cell.append(missing(metric.reason));
      } else {
        cell.append(document.createTextNode(metric.format(value, object)));
        cell.append(element('span', 'value-tag', metric.tag));
        if (min !== null && value === min && min !== max) cell.classList.add('min-value');
        if (max !== null && value === max && min !== max) cell.classList.add('max-value');
      }
      row.append(cell);
    });
    table.tBodies[0].append(row);
  }
}

function renderCharts() {
  renderOrbitPlot($('orbit-chart'), state.objects, { mode: state.orbitMode, now, selectedId: state.selectedId });
  const xMetric = SCATTER_METRICS.find(metric => metric.key === state.xKey);
  const yMetric = SCATTER_METRICS.find(metric => metric.key === state.yKey);
  renderScatter($('scatter-chart'), state.objects, {
    xKey: state.xKey, yKey: state.yKey, xLabel: `${xMetric.label} (${xMetric.unit || 'unitless'})`,
    yLabel: `${yMetric.label} (${yMetric.unit || 'unitless'})`, xLog: state.xLog,
    yLog: state.yLog, selectedId: state.selectedId,
  });
}

function renderAll() {
  renderSelection();
  renderComparison();
  renderCharts();
}

function removeObject(id) {
  if (state.objects.length <= 2) return;
  state.objects = state.objects.filter(object => object.id !== id);
  if (state.selectedId === id) state.selectedId = state.objects[0].id;
  setStatus('Object removed. At least two objects stay in the comparison.');
  renderAll();
}

function addObject(object) {
  if (state.objects.some(item => item.id === object.id)) {
    setStatus(`${object.name} is already in the comparison.`);
    state.selectedId = object.id;
    renderAll();
    return;
  }
  if (state.objects.length >= 6) {
    setStatus('The comparison is full. Remove one object before adding another.', true);
    return;
  }
  const derived = deriveObject(object, now);
  state.objects.push(derived);
  state.selectedId = derived.id;
  setStatus(`${derived.name} added. JPL values and two-body calculations are shown separately.`);
  renderAll();
}

// Plain-words lookup errors (Full function test neo-1). AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
class LookupError extends Error {}
const SBDB_TIMEOUT_MS = 20000;
async function sbdbFetch(params) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(`/jpl/sbdb?${params}`, { signal: AbortSignal.timeout(SBDB_TIMEOUT_MS) });
    } catch (error) {
      console.warn('SBDB lookup failed:', error);
      throw new LookupError('NASA/JPL’s Small-Body Database isn’t answering right now. Please try again in a minute');
    }
    if (response.ok) return response;
    // the relay says 502/503 when JPL is busy or refuses the name: ask once more, then explain
    if (attempt === 0 && (response.status === 502 || response.status === 503)) { await new Promise(r => setTimeout(r, 1200)); continue; }
    console.warn('SBDB lookup failed: relay HTTP', response.status);
    throw new LookupError(`NASA/JPL’s Small-Body Database didn’t return “${params.get('sstr')}”. It may be busy, or it may not know that name. Please try again, or type its number or designation`);
  }
}

async function loadJpl(query, label = query) {
  setStatus(`Looking up “${label}” in the JPL Small-Body Database…`);
  const params = new URLSearchParams({ sstr: query, 'phys-par': '1', 'ca-data': '1', 'ca-body': 'Earth', 'full-prec': '1' });
  const response = await sbdbFetch(params);
  const payload = await response.json();
  if (payload.list?.length) {
    const options = payload.list.slice(0, 8).map(match => {
      const button = element('button', 'key match-key', match.name || match.pdes);
      button.type = 'button';
      button.addEventListener('click', () => loadJpl(match.pdes).catch(showLookupError));
      return button;
    });
    setStatus('JPL found several matches. Choose one: ', false, options);
    return;
  }
  const object = objectFromSbdb(payload, now);
  if (!object) throw new Error(payload.message || 'no matching object was returned');
  addObject(object);
}

function showLookupError(error) {
  if (error instanceof LookupError) { setStatus(`${error.message}.`, true); return; }
  console.warn('Orbit lookup failed:', error);
  setStatus(`That object could not be added: ${error.message}.`, true);
}

window.addEventListener('starshift:add-orbit-object', event => {
  const query = String(event.detail?.query || '').trim();
  if (query) loadJpl(query, String(event.detail?.label || query)).catch(showLookupError);
});

function populateControls() {
  const order = $('object-order');
  METRICS.forEach(metric => order.append(new Option(metric.label, metric.key, false, metric.key === state.orderKey)));
  for (const select of [$('scatter-x'), $('scatter-y')]) {
    SCATTER_METRICS.forEach(metric => select.append(new Option(`${metric.label} · ${metric.unit || 'unitless'}`, metric.key)));
  }
  $('scatter-x').value = state.xKey;
  $('scatter-y').value = state.yKey;
}

$('object-search').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('object-query');
  const query = input.value.trim();
  if (!query) { setStatus('Enter a planet, Moon, asteroid name or designation.', true); return; }
  const builtIn = findBuiltIn(query);
  if (builtIn) addObject(builtIn); else loadJpl(query).catch(showLookupError);
  input.value = '';
});

document.querySelectorAll('[data-orbit-mode]').forEach(button => button.addEventListener('click', () => {
  state.orbitMode = button.dataset.orbitMode;
  document.querySelectorAll('[data-orbit-mode]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  renderCharts();
}));

$('object-order').addEventListener('change', event => { state.orderKey = event.target.value; renderComparison(); });
$('scatter-x').addEventListener('change', event => { state.xKey = event.target.value; renderCharts(); });
$('scatter-y').addEventListener('change', event => { state.yKey = event.target.value; renderCharts(); });
$('x-scale').addEventListener('click', event => { state.xLog = !state.xLog; event.currentTarget.setAttribute('aria-pressed', String(state.xLog)); renderCharts(); });
$('y-scale').addEventListener('click', event => { state.yLog = !state.yLog; event.currentTarget.setAttribute('aria-pressed', String(state.yLog)); renderCharts(); });

populateControls();
renderAll();
