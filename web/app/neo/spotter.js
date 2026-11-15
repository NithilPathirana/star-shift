// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
import {
  DEFAULT_DATES, NEO_DEFAULT_VIEW, buildSbIdentParams, observationDates, parseSbIdent, sbdbQuery,
  exposureForDate, mjdToIso, timeLapseHref,
} from './sb-ident.js';
import { listImagesSIA } from '../../core/irsa.js'; // SPHEREx exposure times of the field (Claude)
import { prebakedFetch } from '../../core/prebaked.js'; // the five demo targets answer from web/prebaked/ (Claude)
import { SPHEREX_VISIBLE_V } from '../spot/logic.js'; // Spot's own faintness rule (Claude)
import '../expert.js'; // Simple / Expert twins below: .x-only (RA/Dec, ISO dates, ″/h) and .s-only (plain words) (Claude)
import { bothaCheckText, checkAppliesTo, loadBothaCheck } from './botha-check.js'; // measured Botha check (Claude)

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

function finiteParam(name, fallback, min, max) {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

// No field in the URL: the example field and its real SPHEREx dates (b7). A field without dates
// keeps the survey mid-dates. (Claude)
const customField = ['ra', 'dec', 'fov'].some(name => (params.get(name) || '').trim() !== '');
const view = {
  ra: finiteParam('ra', NEO_DEFAULT_VIEW.ra, 0, 360),
  dec: finiteParam('dec', NEO_DEFAULT_VIEW.dec, -90, 90),
  fov: finiteParam('fov', NEO_DEFAULT_VIEW.fov, 0.001, 20),
  dates: observationDates(params.get('dates'), customField ? DEFAULT_DATES : NEO_DEFAULT_VIEW.dates),
};
view.isDefault = view.ra === NEO_DEFAULT_VIEW.ra && view.dec === NEO_DEFAULT_VIEW.dec && view.fov === NEO_DEFAULT_VIEW.fov
  && view.dates.join() === NEO_DEFAULT_VIEW.dates.join();

// Measured check of the example asteroid (web/data/botha-check.json); null keeps the prediction wording (Claude)
let bothaCheck = null, bothaWords = null;
const bothaCheckP = loadBothaCheck(AbortSignal.timeout(10000)).then((check) => {
  bothaCheck = check; bothaWords = bothaCheckText(check);
  const note = $('botha-check-note');
  if (bothaWords && note) note.replaceChildren(...twin(bothaWords.expert, bothaWords.simple));
});

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
const arcminText = (sep) => `${sep < 10 ? sep.toFixed(1) : Math.round(sep)}′`;

// The time each date's JPL positions are for (sb-ident.js exposureForDate): SPHEREx's exposure of
// this field, from IRSA's image list of the field centre; 12:00 UTC when there is none that day
// or IRSA does not answer, and the page says which. AI-written code (Claude, Anthropic) for team
// Proper Motion, NASA Space Apps 2026.
const SIA_MS = 20000;
const hhmm = (mjd) => mjdToIso(mjd).slice(11, 16);
async function fieldTimes(dates, signal) {
  let images = null;
  try {
    images = await listImagesSIA(view.ra, view.dec, { base: location.origin, signal: AbortSignal.any([signal, AbortSignal.timeout(SIA_MS)]) });
  } catch (error) {
    if (signal.aborted) throw error;
    console.warn('IRSA image list for the field failed:', error);
  }
  const missing = images?.missing?.length ? images.missing : null; // a release did not answer
  return Object.fromEntries(dates.map(date => {
    const time = exposureForDate(images || [], date);
    if (!images || (missing && !time.covered)) time.unchecked = true;
    return [date, time];
  }));
}
function timeNote(time) { // [expert, simple] for under the date
  if (time?.covered) return [`${mjdToIso(time.mjd).slice(11, 19)} UTC · ${time.exposure || 'SPHEREx'}${time.detector ? ` D${time.detector}` : ''}`, `SPHEREx image, ${hhmm(time.mjd)} UTC`];
  if (time?.unchecked) return ['12:00 UTC (image times not checked)', '12:00 UTC (image times not checked)'];
  return ['12:00 UTC (no SPHEREx image that day)', '12:00 UTC, no SPHEREx image that day'];
}
function renderTimes(times) {
  const note = $('spotter-times');
  if (!note) return;
  const list = Object.values(times);
  if (!list.length) { note.hidden = true; return; }
  const plain = list.map(t => t.covered ? `${plainDay(t.date)} at ${hhmm(t.mjd)} UTC${t.visits > 1 ? ` (the longest of ${t.visits} visits that day)` : ''}`
    : `${plainDay(t.date)}: ${t.unchecked ? 'IRSA did not answer, so 12:00 UTC' : 'no SPHEREx image of this field, so 12:00 UTC'}`);
  const expert = list.map(t => t.covered ? `${t.date} ${mjdToIso(t.mjd).slice(11, 19)} UTC (${t.exposure || 'exposure'}${t.detector ? `, D${t.detector}` : ''}; visit of ${t.visit.exposures} exposure${t.visit.exposures === 1 ? '' : 's'}${t.visits > 1 ? `, longest of ${t.visits} that day` : ''})`
    : `${t.date} 12:00 UTC (${t.unchecked ? 'IRSA image list not available' : 'no SPHEREx image covers the field centre'})`);
  note.replaceChildren(document.createTextNode(' JPL positions are for the moment SPHEREx imaged this field: '),
    ...twin(expert.join(' · '), plain.join(' · ')), document.createTextNode('.'));
  note.hidden = false;
}

function coordinateToDegrees(value, isRa) {
  const match = /^([+\-]?)(\d+)[ :](\d+)[ :'](\d+(?:\.\d+)?)/.exec(String(value || '').replace(/[hms°′″"]/g, ':'));
  if (!match) return null;
  const total = Number(match[2]) + Number(match[3]) / 60 + Number(match[4]) / 3600;
  return (match[1] === '-' ? -total : total) * (isRa ? 15 : 1);
}

async function fetchIdentification(date, kind, signal, time = null) {
  const base = { ...view, date, kind, obsTime: time?.obsTime ?? null };
  const first = await prebakedFetch(`/jpl/sb_ident?${buildSbIdentParams(base)}`, { signal });
  if (first.ok) return { rows: parseSbIdent(await first.json(), { date, kind }), retried: false };

  // JPL's current docs reject MPC 500 even though the product brief requests it.
  const retry = await prebakedFetch(`/jpl/sb_ident?${buildSbIdentParams({ ...base, observer: 'geocentric-state' })}`, { signal });
  if (!retry.ok) throw new Error(`${date} ${kind === 'a' ? 'asteroids' : 'comets'}: MPC 500 returned HTTP ${first.status}; geocentric retry returned HTTP ${retry.status}`);
  return { rows: parseSbIdent(await retry.json(), { date, kind }), retried: true };
}

// A busy ecliptic field returns 100+ objects, nearly all far too faint: the table shows every object
// SPHEREx could see and fills up to ROW_LIMIT with the brightest of the rest; one key shows them all (b7, Claude).
const ROW_LIMIT = 12;
const canSee = (item) => !(item.visualMagnitude !== null && item.visualMagnitude > SPHEREX_VISIBLE_V);
let showAllRows = false;
function renderRows(rows) {
  const body = $('spotter-table').tBodies[0];
  body.replaceChildren();
  const visible = rows.filter(canSee).length;
  const limit = Math.max(ROW_LIMIT, visible);
  let faintBudget = limit - visible;
  const shown = showAllRows || rows.length <= limit + 2 ? rows : rows.filter(item => canSee(item) || faintBudget-- > 0);
  for (const item of shown) {
    const row = element('tr');
    const object = element('td', 'object-cell');
    object.dataset.label = 'Object';
    object.append(element('strong', '', item.name), element('small', '', item.kind === 'c' ? 'Comet' : 'Asteroid'));
    // The example field's asteroid: our measurement of the images (tools/botha_check.mjs), not JPL's (Claude)
    if (bothaWords && checkAppliesTo(bothaCheck, item)) {
      object.append(...twin(bothaWords.rowExpert, bothaWords.rowSimple, 'small'));
      object.style.height = 'auto'; // a third line: the 36 px grid cell would let it spill into the next row
    }
    const date = element('td', 'num'); date.dataset.label = 'Date';
    const [xTime, sTime] = timeNote(item.time);
    date.append(...twin(item.date || '—', plainDay(item.date)), element('small', 'x-only', xTime), element('small', 's-only', sTime));
    const position = element('td', 'num'); position.dataset.label = 'Predicted position';
    const raDeg = coordinateToDegrees(item.ra, true), decDeg = coordinateToDegrees(item.dec, false);
    const sep = arcminFromCentre(raDeg, decDeg);
    position.append(element('span', 'x-only', raDeg === null ? (item.ra || '—') : fmtRA(raDeg)), element('small', 'x-only', decDeg === null ? (item.dec || '—') : fmtDec(decDeg)),
      element('span', 's-only', sep === null ? 'inside the field' : `${arcminText(sep)} from the centre`));
    if (sep !== null) position.title = `${arcminText(sep)} from the field centre ${item.time?.covered ? 'when SPHEREx took the image' : 'at 12:00 UTC'}`;
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
    // centred on JPL's place at the exposure time, opening on that exposure (?mjd=&det=)
    timeLapse.href = ra === null || dec === null ? timeLapseHref(view.ra, view.dec, item.time) : timeLapseHref(ra, dec, item.time);
    const add = element('button', 'key compact-key', 'Add to comparison');
    add.type = 'button';
    add.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('starshift:add-orbit-object', { detail: { query: sbdbQuery(item.name), label: item.name } }));
      activateTab('orbits', true, true);
    });
    actions.append(timeLapse, add);
    row.append(object, date, position, magnitude, motion, actions);
    body.append(row);
  }
  if (shown.length < rows.length) {
    const row = element('tr', 'more-rows'), cell = element('td');
    cell.colSpan = 6;
    const hidden = rows.length - shown.length;
    const more = element('button', 'key compact-key', `Show ${hidden} more`);
    more.type = 'button';
    more.addEventListener('click', () => { showAllRows = true; renderRows(rows); });
    cell.append(more, element('span', 'more-note', ` all fainter than V ${SPHEREX_VISIBLE_V}, too faint for SPHEREx to see`));
    row.append(cell);
    body.append(row);
  }
  $('spotter-count').textContent = `${rows.length} match${rows.length === 1 ? '' : 'es'}${visible ? ` · ${visible} bright enough for SPHEREx` : ''}`;
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
  let results, times;
  try {
    times = await fieldTimes(dates, signal);
    if (currentRun !== run) return;
    renderTimes(times);
    results = await Promise.allSettled(dates.flatMap(date => ['a', 'c'].map(kind => fetchIdentification(date, kind, signal, times[date]))));
  } finally { clearTimeout(slow); }
  if (currentRun !== run) return; // Retry started a newer run
  const rows = results.flatMap(result => result.status === 'fulfilled' ? result.value.rows : []);
  for (const item of rows) item.time = times[item.date] || null;
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason?.message || String(result.reason));
  const retried = results.filter(result => result.status === 'fulfilled' && result.value.retried).length;
  // by date, then brightest first (no magnitude last), so what SPHEREx could see leads (b7, Claude)
  const mag = (item) => item.visualMagnitude ?? Infinity;
  await bothaCheckP; // a small local file; never rejects
  if (currentRun !== run) return;
  renderRows(rows.sort((a, b) => a.date.localeCompare(b.date) || mag(a) - mag(b) || a.name.localeCompare(b.name)));
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

// b7: the two tabs live inside the "More from JPL" disclosure; choosing one opens it (Claude)
function activateTab(name, updateUrl = false, reveal = false) {
  const selected = name === 'orbits' ? 'orbits' : 'threat';
  document.querySelectorAll('[data-spotter-tab]').forEach(button => {
    const active = button.dataset.spotterTab === selected;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $('threat-panel').hidden = selected !== 'threat';
  $('orbits-panel').hidden = selected !== 'orbits';
  if (selected === 'orbits' || reveal) $('more-jpl').open = true;
  if (reveal) requestAnimationFrame(() => $(selected === 'orbits' ? 'orbits-tab' : 'threat-tab').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce' ? 'auto' : 'smooth' }));
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
activateTab(params.get('tab') === 'orbits' ? 'orbits' : 'threat', false, params.get('tab') === 'orbits');
$('spotter-default-note').hidden = !view.isDefault;
loadSpotter().catch(spotterFailed);
