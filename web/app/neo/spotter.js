// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
import {
  DEFAULT_DATES, buildSbIdentParams, observationDates, parseSbIdent,
} from './sb-ident.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

function finiteParam(name, fallback, min, max) {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

const view = {
  ra: finiteParam('ra', 269.4461, 0, 360),
  dec: finiteParam('dec', 4.7707, -90, 90),
  fov: finiteParam('fov', 0.5, 0.001, 20),
  dates: observationDates(params.get('dates')),
};

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function number(value, digits = 2) {
  return value === null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

// The app's coordinate format (DESIGN.md 25): 17h 58m 12.6s, +04° 32′ 33″ (JPL gives about 0.1 s and 1″).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
function fmtRA(deg) {
  let t = Math.round((((deg % 360) + 360) % 360) / 15 * 36000) % (24 * 36000); // tenths of a time-second
  const h = Math.floor(t / 36000); t -= h * 36000; const m = Math.floor(t / 600); t -= m * 600;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${(t / 10).toFixed(1).padStart(4, '0')}s`;
}
function fmtDec(deg) {
  let t = Math.round(Math.abs(deg) * 3600); const sign = deg < 0 && t > 0 ? '−' : '+';
  const d = Math.floor(t / 3600); t -= d * 3600; const m = Math.floor(t / 60); t -= m * 60;
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${String(t).padStart(2, '0')}″`;
}

function coordinateToDegrees(value, isRa) {
  const match = /^([+\-]?)(\d+)[ :](\d+)[ :'](\d+(?:\.\d+)?)/.exec(String(value || '').replace(/[hms°′″"]/g, ':'));
  if (!match) return null;
  const total = Number(match[2]) + Number(match[3]) / 60 + Number(match[4]) / 3600;
  return (match[1] === '-' ? -total : total) * (isRa ? 15 : 1);
}

async function fetchIdentification(date, kind) {
  const base = { ...view, date, kind };
  const first = await fetch(`/jpl/sb_ident?${buildSbIdentParams(base)}`);
  if (first.ok) return { rows: parseSbIdent(await first.json(), { date, kind }), retried: false };

  // JPL's current docs reject MPC 500 even though the product brief requests it.
  const retry = await fetch(`/jpl/sb_ident?${buildSbIdentParams({ ...base, observer: 'geocentric-state' })}`);
  if (!retry.ok) throw new Error(`${date} ${kind === 'a' ? 'asteroids' : 'comets'}: MPC 500 returned HTTP ${first.status}; geocentric retry returned HTTP ${retry.status}`);
  return { rows: parseSbIdent(await retry.json(), { date, kind }), retried: true };
}

function renderRows(rows) {
  const body = $('spotter-table').tBodies[0];
  body.replaceChildren();
  for (const item of rows) {
    const row = element('tr');
    const object = element('td', 'object-cell');
    object.dataset.label = 'Object';
    object.append(element('strong', '', item.name), element('small', '', item.kind === 'c' ? 'Comet' : 'Asteroid'));
    const date = element('td', 'num', item.date || '—'); date.dataset.label = 'Date';
    const position = element('td', 'num'); position.dataset.label = 'Predicted position';
    const raDeg = coordinateToDegrees(item.ra, true), decDeg = coordinateToDegrees(item.dec, false);
    position.append(element('span', '', raDeg === null ? (item.ra || '—') : fmtRA(raDeg)), element('small', '', decDeg === null ? (item.dec || '—') : fmtDec(decDeg)));
    const magnitude = element('td', 'num', item.visualMagnitude === null ? '—' : `${number(item.visualMagnitude, 2)} mag`);
    magnitude.dataset.label = 'V magnitude';
    if (item.visualMagnitude === null) magnitude.title = 'JPL did not report a visual magnitude';
    const motion = element('td', 'num', item.motionArcsecHour === null ? '—' : `${number(item.motionArcsecHour, 2)} ″/h`);
    motion.dataset.label = 'Motion';
    if (item.motionArcsecHour === null) motion.title = 'JPL did not report both motion components';
    const actions = element('td', 'spotter-actions'); actions.dataset.label = 'Actions';
    const ra = coordinateToDegrees(item.ra, true);
    const dec = coordinateToDegrees(item.dec, false);
    const timeLapse = element('a', 'key compact-key', 'Show in time-lapse');
    timeLapse.href = ra === null || dec === null
      ? `index.html?ra=${view.ra}&dec=${view.dec}&scene=viewer`
      : `index.html?ra=${ra.toFixed(6)}&dec=${dec.toFixed(6)}&scene=viewer`;
    const add = element('button', 'key compact-key', 'Add to comparison');
    add.type = 'button';
    add.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('starshift:add-orbit-object', { detail: { query: item.name } }));
      activateTab('orbits', true);
    });
    actions.append(timeLapse, add);
    row.append(object, date, position, magnitude, motion, actions);
    body.append(row);
  }
  $('spotter-count').textContent = `${rows.length} match${rows.length === 1 ? '' : 'es'}`;
}

function dateRange() {
  const from = $('spotter-from').value;
  const to = $('spotter-to').value;
  return view.dates.filter(date => (!from || date >= from) && (!to || date <= to));
}

async function loadSpotter() {
  const dates = dateRange();
  if (!dates.length) {
    renderRows([]);
    $('spotter-status').textContent = 'No supplied SPHEREx observation dates fall inside this date range. Add dates with the dates= URL parameter.';
    $('spotter-status').classList.add('error');
    return;
  }
  $('spotter-status').classList.remove('error');
  $('spotter-status').textContent = `Checking ${dates.length} distinct SPHEREx observation date${dates.length === 1 ? '' : 's'} with JPL…`;
  const requests = dates.flatMap(date => ['a', 'c'].map(kind => fetchIdentification(date, kind)));
  const results = await Promise.allSettled(requests);
  const rows = results.flatMap(result => result.status === 'fulfilled' ? result.value.rows : []);
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason.message);
  const retried = results.filter(result => result.status === 'fulfilled' && result.value.retried).length;
  renderRows(rows.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)));
  if (failures.length) {
    $('spotter-status').textContent = `Loaded ${rows.length} matches; ${failures.length} of ${results.length} JPL checks failed. ${failures.join(' · ')}`;
    $('spotter-status').classList.add('error');
  } else if (retried) {
    $('spotter-status').textContent = `Loaded ${rows.length} matches. JPL rejected MPC code 500, so ${retried} checks used an equivalent geocentric state-vector retry.`;
  } else {
    $('spotter-status').textContent = `Loaded ${rows.length} known asteroids and comets predicted inside this field.`;
  }
}

function activateTab(name, updateUrl = false) {
  const selected = name === 'orbits' ? 'orbits' : 'spotter';
  document.querySelectorAll('[data-spotter-tab]').forEach(button => {
    const active = button.dataset.spotterTab === selected;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $('spotter-panel').hidden = selected !== 'spotter';
  $('orbits-panel').hidden = selected !== 'orbits';
  if (updateUrl) {
    const url = new URL(location.href);
    if (selected === 'orbits') url.searchParams.set('tab', 'orbits'); else url.searchParams.delete('tab');
    history.replaceState(null, '', url);
  }
}

document.querySelectorAll('[data-spotter-tab]').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.spotterTab, true)));

$('spotter-controls').addEventListener('submit', event => {
  event.preventDefault();
  const url = new URL(location.href);
  for (const [name, id] of [['ra', 'spotter-ra'], ['dec', 'spotter-dec'], ['fov', 'spotter-fov']]) url.searchParams.set(name, $(id).value);
  url.searchParams.set('dates', view.dates.join(','));
  if ($('spotter-from').value) url.searchParams.set('from', $('spotter-from').value);
  if ($('spotter-to').value) url.searchParams.set('to', $('spotter-to').value);
  location.assign(url);
});

$('spotter-ra').value = view.ra;
$('spotter-dec').value = view.dec;
$('spotter-fov').value = view.fov;
$('spotter-from').value = params.get('from') || view.dates[0] || DEFAULT_DATES[0];
$('spotter-to').value = params.get('to') || view.dates.at(-1) || DEFAULT_DATES.at(-1);
$('spotter-dates').textContent = view.dates.join(' · ');
activateTab(params.get('tab') === 'orbits' ? 'orbits' : 'spotter');
loadSpotter().catch(error => {
  $('spotter-status').textContent = `JPL identification could not be loaded: ${error.message}. Check the relay route and the strict coordinate/date formats.`;
  $('spotter-status').classList.add('error');
});
