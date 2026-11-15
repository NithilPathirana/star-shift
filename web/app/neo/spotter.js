// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
import {
  DEFAULT_DATES, buildSbIdentParams, observationDates, parseSbIdent, sbdbQuery,
} from './sb-ident.js';
import { prebakedFetch } from '../../core/prebaked.js'; // the five demo targets answer from web/prebaked/ (Claude)
import { SPHEREX_VISIBLE_V } from '../spot/logic.js'; // Spot's own faintness rule (Claude)
import '../expert.js'; // Simple / Expert twins below: .x-only (RA/Dec, ISO dates, ″/h) and .s-only (plain words) (Claude)

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

// Plain-words twins for Simple mode. AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
const plainDay = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const plainMonth = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
function twin(expert, simple, tag = 'span') {
  const x = element(tag, 'x-only', expert), s = element(tag, 's-only', simple);
  return [x, s];
}
function arcminFromCentre(ra, dec) { // small-angle distance from the field centre
  if (ra === null || dec === null) return null;
  const r = Math.PI / 180, dra = ((ra - view.ra + 540) % 360 - 180) * Math.cos(view.dec * r);
  return Math.hypot(dra, dec - view.dec) * 60;
}

function coordinateToDegrees(value, isRa) {
  const match = /^([+\-]?)(\d+)[ :](\d+)[ :'](\d+(?:\.\d+)?)/.exec(String(value || '').replace(/[hms°′″"]/g, ':'));
  if (!match) return null;
  const total = Number(match[2]) + Number(match[3]) / 60 + Number(match[4]) / 3600;
  return (match[1] === '-' ? -total : total) * (isRa ? 15 : 1);
}

async function fetchIdentification(date, kind, signal) {
  const base = { ...view, date, kind };
  const first = await prebakedFetch(`/jpl/sb_ident?${buildSbIdentParams(base)}`, { signal });
  if (first.ok) return { rows: parseSbIdent(await first.json(), { date, kind }), retried: false };

  // JPL's current docs reject MPC 500 even though the product brief requests it.
  const retry = await prebakedFetch(`/jpl/sb_ident?${buildSbIdentParams({ ...base, observer: 'geocentric-state' })}`, { signal });
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
    const date = element('td', 'num'); date.dataset.label = 'Date';
    date.append(...twin(item.date || '—', plainDay(item.date)));
    const position = element('td', 'num'); position.dataset.label = 'Predicted position';
    const raDeg = coordinateToDegrees(item.ra, true), decDeg = coordinateToDegrees(item.dec, false);
    const sep = arcminFromCentre(raDeg, decDeg);
    position.append(element('span', 'x-only', raDeg === null ? (item.ra || '—') : fmtRA(raDeg)), element('small', 'x-only', decDeg === null ? (item.dec || '—') : fmtDec(decDeg)),
      element('span', 's-only', sep === null ? 'inside the field' : `${Math.round(sep)}′ from the centre`));
    const magnitude = element('td', 'num', item.visualMagnitude === null ? '—' : `${item.visualMagnitude.toFixed(1)} mag`);
    magnitude.dataset.label = 'V magnitude';
    if (item.visualMagnitude === null) magnitude.title = 'JPL did not report a visual magnitude';
    // Spot's rule: fainter than V 18.5 is too faint for SPHEREx; 2 mag past it is far too faint (Claude)
    const tooFaint = item.visualMagnitude !== null && item.visualMagnitude > SPHEREX_VISIBLE_V;
    const faintText = tooFaint ? `${item.visualMagnitude >= SPHEREX_VISIBLE_V + 2 ? 'far ' : ''}too faint for SPHEREx to see` : '';
    if (tooFaint) magnitude.append(element('small', 'faint-note', faintText));
    const motion = element('td', 'num');
    if (item.motionArcsecHour === null) motion.textContent = '—';
    else motion.append(...twin(`${item.motionArcsecHour.toFixed(2)} ″/h`, `${Math.round(item.motionArcsecHour)}″ an hour`));
    motion.dataset.label = 'Motion';
    if (item.motionArcsecHour === null) motion.title = 'JPL did not report both motion components';
    const actions = element('td', 'spotter-actions'); actions.dataset.label = 'Actions';
    const ra = coordinateToDegrees(item.ra, true);
    const dec = coordinateToDegrees(item.dec, false);
    // Too faint: the key still opens the patch, but says so instead of promising the object (Claude)
    const timeLapse = element('a', 'key compact-key', tooFaint ? 'Show the patch' : 'Show in time-lapse');
    if (tooFaint) timeLapse.title = `Opens this patch in the time-lapse. ${item.name} is ${faintText}, so it will not show in the images.`;
    timeLapse.href = ra === null || dec === null
      ? `index.html?ra=${view.ra}&dec=${view.dec}&scene=viewer`
      : `index.html?ra=${ra.toFixed(6)}&dec=${dec.toFixed(6)}&scene=viewer`;
    const add = element('button', 'key compact-key', 'Add to comparison');
    add.type = 'button';
    add.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('starshift:add-orbit-object', { detail: { query: sbdbQuery(item.name), label: item.name } }));
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

// A hung JPL never leaves the page silent (Full function test neo-2): after SLOW_MS the status says
// JPL isn't answering yet and offers Retry while the request keeps going (a new field can take 1-2
// minutes, then the relay caches it); after GIVE_UP_MS it stops. AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
const SLOW_MS = 20000, GIVE_UP_MS = 150000;
let currentRun = null;

function spotterStatus(text, isError = false, retry = false) {
  const status = $('spotter-status');
  status.replaceChildren(document.createTextNode(text));
  status.classList.toggle('error', isError);
  if (retry) {
    const button = element('button', 'key compact-key status-retry', 'Retry');
    button.type = 'button';
    button.addEventListener('click', () => { loadSpotter().catch(spotterFailed); });
    status.append(' ', button);
  }
}

async function loadSpotter() {
  currentRun?.abort();
  const run = new AbortController();
  currentRun = run;
  const dates = dateRange();
  if (!dates.length) {
    renderRows([]);
    spotterStatus('No supplied SPHEREx observation dates fall inside this date range. Add dates with the dates= URL parameter.', true);
    return;
  }
  $('spotter-count').textContent = '—';
  spotterStatus(`Checking ${dates.length} distinct SPHEREx observation date${dates.length === 1 ? '' : 's'} with JPL…`);
  const signal = AbortSignal.any([run.signal, AbortSignal.timeout(GIVE_UP_MS)]);
  const slow = setTimeout(() => {
    if (currentRun === run) spotterStatus('NASA/JPL isn’t answering yet. A field nobody has asked about can take a minute or two; still waiting.', true, true);
  }, SLOW_MS);
  let results;
  try {
    results = await Promise.allSettled(dates.flatMap(date => ['a', 'c'].map(kind => fetchIdentification(date, kind, signal))));
  } finally { clearTimeout(slow); }
  if (currentRun !== run) return; // Retry started a newer run
  const rows = results.flatMap(result => result.status === 'fulfilled' ? result.value.rows : []);
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason?.message || String(result.reason));
  const retried = results.filter(result => result.status === 'fulfilled' && result.value.retried).length;
  renderRows(rows.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)));
  if (failures.length) {
    // Plain words on the page; the raw errors go to the console (Claude)
    console.warn('JPL field checks failed:', failures);
    const allFailed = failures.length === results.length;
    if (allFailed) $('spotter-count').textContent = 'No answer';
    spotterStatus(allFailed
      ? 'NASA/JPL isn’t answering right now, so we can’t say which asteroids are in this field. This does not mean there are none.'
      : `Showing ${rows.length} match${rows.length === 1 ? '' : 'es'}, but NASA/JPL didn’t answer for ${failures.length} of ${results.length} checks, so some may be missing.`, true, true);
  } else if (retried) {
    spotterStatus(`Loaded ${rows.length} matches. JPL rejected MPC code 500, so ${retried} checks used an equivalent geocentric state-vector retry.`);
  } else {
    spotterStatus(`Loaded ${rows.length} known asteroids and comets predicted inside this field.`);
  }
}

function spotterFailed(error) {
  console.warn('JPL field check failed:', error);
  $('spotter-count').textContent = 'No answer';
  spotterStatus('NASA/JPL isn’t answering right now, so we can’t say which asteroids are in this field.', true, true);
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
$('spotter-dates-plain').textContent = view.dates.map(plainMonth).join(' · ');
activateTab(params.get('tab') === 'orbits' ? 'orbits' : 'spotter');
loadSpotter().catch(spotterFailed);
