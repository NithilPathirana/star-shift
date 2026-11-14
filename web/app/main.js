// Wires the page to the state store, the data pipeline and the canvas renderer.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { parseQuery, QueryError, fromURL, toURL, formatRA, formatDec, validSetting } from './query.js';
import { createStore, reducer, initialState } from './state.js';
import { run, buildStacks, BANDS, resolveTarget, measureMotion, tangentialVelocity } from './data.js';
import { SkyMap, CHANNEL_UM } from './skymap.js';
import { staticDetails, coverageHTML, neighboursHTML, observerHTML, setObserver, parseLatLon } from './details.js';
import { propagate } from '../core/motion.js';
import { loadBands, saveBands, resetBands, validateBand, BandError, layersFor, channelsFor, detectorsFor } from './bands.js';
import { gridToWorld } from '../core/align.js';
import { drawFrame } from './render.js';
import { PRESETS, findPreset } from './presets.js';

const $ = (id) => document.getElementById(id);
const BASE = location.origin; // the local server relays IRSA/Gaia on the same origin
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
// "31 Oct – 13 Dec 2025" (year once when both dates share it)
const fmtRange = (a, b) => (a.getUTCFullYear() === b.getUTCFullYear()
  ? `${a.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${fmtDate(b)}`
  : `${fmtDate(a)} – ${fmtDate(b)}`);
const fmtDateTime = (d) => `${fmtDate(d)}, ${d.toISOString().slice(11, 16)} UTC`;

const ICON = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
};
$('prev').innerHTML = ICON.prev;
$('next').innerHTML = ICON.next;
$('play').innerHTML = ICON.play;

let tables = null;
const tablesReady = fetch('core/data/spectral_wcs.json').then(r => r.json()).then(t => { tables = t; }).catch(() => {});

const store = createStore(reducer, initialState);
let controller = null;
let stacksCache = { key: '', stacks: [] };

// ---------- helpers ----------
function stacks(state) {
  const key = state.requestId + ':' + state.frames.length;
  if (stacksCache.key !== key) stacksCache = { key, stacks: state.frames.length ? buildStacks(state.frames) : [] };
  return stacksCache.stacks;
}
function items(state) { return state.settings.view === 'stacks' ? stacks(state) : state.frames; }
function current(state) { const list = items(state); return list[Math.min(state.index, list.length - 1)] || null; }

function updateURL(push) {
  const s = store.get();
  const url = location.pathname + toURL(s.query, s.settings);
  if (url !== location.pathname + location.search) history[push ? 'pushState' : 'replaceState'](null, '', url);
}

// ---------- search ----------
async function search(query, { push = true } = {}) {
  if (store.get().settings.mode === 'map') return mapSearch(query, push);
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  store.dispatch({ type: 'SEARCH', query });
  const requestId = store.get().requestId;
  updateURL(push);
  await tablesReady;
  run(query, store.get().settings, {
    base: BASE, signal, tables,
    emit: (a) => store.dispatch({ ...a, requestId }),
  });
}

function showQueryError(msg) {
  const el = $('q-error');
  el.textContent = msg || '';
  el.hidden = !msg;
  $('q').setAttribute('aria-invalid', msg ? 'true' : 'false');
}

$('search').addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    const q = parseQuery($('q').value);
    showQueryError('');
    search(q);
  } catch (err) {
    if (err instanceof QueryError) { showQueryError(err.message); $('q').focus(); } else throw err;
  }
});
$('q').addEventListener('input', () => showQueryError(''));

function targetButtons(listEl) {
  for (const p of PRESETS) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = p.label;
    b.title = p.note;
    b.dataset.key = p.key;
    b.addEventListener('click', () => { $('q').value = p.label; showQueryError(''); setSetting('mode', 'film'); search({ type: 'name', name: p.label }); });
    li.append(b);
    listEl.append(li);
  }
}
targetButtons($('target-list'));
targetButtons($('idle-targets'));

// ---------- player ----------
let timer = null;
function stopTimer() { clearTimeout(timer); timer = null; }
function tick() {
  const s = store.get();
  const n = items(s).length;
  if (!s.playing || n < 2) { stopTimer(); return; }
  store.dispatch({ type: 'STEP', delta: 1, count: n });
  timer = setTimeout(tick, 1000 / s.settings.speed);
}
function play() { if (items(store.get()).length > 1) { store.dispatch({ type: 'PLAY' }); stopTimer(); timer = setTimeout(tick, 1000 / store.get().settings.speed); } }
function pause() { store.dispatch({ type: 'PAUSE' }); stopTimer(); }
function step(delta) { pause(); store.dispatch({ type: 'STEP', delta, count: items(store.get()).length }); }

$('play').addEventListener('click', () => (store.get().playing ? pause() : play()));
$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
$('scrub').addEventListener('input', (e) => { pause(); store.dispatch({ type: 'SET_INDEX', index: Number(e.target.value) }); });
$('speed').addEventListener('change', (e) => setSetting('speed', e.target.value));

document.addEventListener('keydown', (e) => {
  const el = e.target instanceof Element ? e.target : document.body;
  // leave typing fields, menus and native controls (radios, slider) alone
  if (el.closest('input, select, textarea') || e.altKey || e.ctrlKey || e.metaKey) return;
  const n = items(store.get()).length;
  if (!n) return;
  if (e.key === ' ' && !el.closest('button, summary, a')) { e.preventDefault(); store.get().playing ? pause() : play(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === 'Home') { e.preventDefault(); pause(); store.dispatch({ type: 'SET_INDEX', index: 0 }); }
  else if (e.key === 'End') { e.preventDefault(); pause(); store.dispatch({ type: 'SET_INDEX', index: n - 1 }); }
});

// ---------- settings ----------
const RELOAD_KEYS = ['fov', 'band', 'max'];
function setSetting(key, raw) {
  const value = validSetting(key, raw);
  if (value === undefined) return;
  const before = store.get();
  if (before.settings[key] === value) return;
  store.dispatch({ type: 'SET_SETTING', key, value });
  if (key === 'view') store.dispatch({ type: 'SET_INDEX', index: 0 });
  updateURL(false);
  if (RELOAD_KEYS.includes(key) && before.query) search(before.query, { push: false });
  if (key === 'speed' && store.get().playing) { stopTimer(); timer = setTimeout(tick, 1000 / value); }
  if (key === 'ch') { skymap.setChannel(value); $('wl-out').textContent = `${CHANNEL_UM[value].toFixed(2)} µm`; }
  if (key === 'mode') applyMode();
  if (key === 'bands') { $('bands-on').checked = value === 'on'; applyBands(); }
}
$('settings').addEventListener('change', (e) => { if (e.target.name) setSetting(e.target.name, e.target.value); });
document.querySelectorAll('input[name=view]').forEach(r => r.addEventListener('change', (e) => setSetting('view', e.target.value)));
$('empty-allbands').addEventListener('click', () => setSetting('band', 'all'));
$('error-retry').addEventListener('click', () => { const q = store.get().query; if (q) search(q, { push: false }); });
$('copy-link').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); $('status').textContent = 'Link copied.'; }
  catch { $('status').textContent = 'Copy this link from the address bar: ' + location.href; }
});

function syncSettingsForm(settings) {
  for (const [k, v] of Object.entries(settings)) {
    document.querySelectorAll(`[name="${k}"]`).forEach(el => {
      if (el.type === 'radio') el.checked = String(el.value) === String(v);
      else el.value = String(v);
    });
  }
  $('speed').value = String(settings.speed);
}

// ---------- rendering ----------
const canvas = $('sky');
let lastDrawn = { item: undefined, key: '' };
let motionMemo = { key: '', m: null };
function showState(name) {
  for (const id of ['idle', 'loading', 'empty', 'error']) $('state-' + id).hidden = id !== name;
}

function render(state, prev) {
  const list = items(state);
  const n = list.length;
  const busy = ['resolving', 'listing', 'loading'].includes(state.status);

  // overlay states (time-lapse only)
  if (state.settings.mode === 'map') showState(null);
  else if (state.status === 'idle') showState('idle');
  else if (state.status === 'empty') {
    showState('empty');
    const banded = state.settings.band !== 'all';
    $('empty-detail').textContent = banded && state.plan?.total
      ? `SPHEREx has ${state.plan.total} images here, but none in band ${state.settings.band}.`
      : "SPHEREx hasn't imaged this spot in the data released so far. SPHEREx maps the whole sky every six months, so try again after the next data release.";
    $('empty-allbands').hidden = !banded;
  } else if (state.status === 'error') {
    showState('error');
    $('error-detail').textContent = state.error?.message || '';
    $('error-retry').hidden = !state.error?.retryable;
  } else if (busy && n === 0) {
    showState('loading');
  } else if (state.status === 'loading') {
    showState('loading'); // small bar at the bottom while frames keep arriving
  } else showState(null);
  $('state-loading').classList.toggle('has-frames', n > 0);

  // loading text + progress
  const name = state.target?.name || (state.query?.type === 'name' ? state.query.name : 'this spot');
  if (state.status === 'resolving') { $('loading-title').textContent = `Looking up ${name}…`; $('loading-progress').removeAttribute('value'); $('loading-detail').textContent = 'Asking SIMBAD where it is and how fast it moves.'; }
  else if (state.status === 'listing') { $('loading-title').textContent = 'Finding SPHEREx images…'; $('loading-progress').removeAttribute('value'); $('loading-detail').textContent = 'Asking the NASA/IPAC archive (IRSA) which images cover this spot. This can take up to a minute.'; }
  else if (state.status === 'loading' && state.plan) {
    const done = state.frames.length + state.failed;
    $('loading-progress').max = state.plan.planned;
    $('loading-progress').value = done;
    $('loading-title').textContent = `Downloading frames: ${done} of ${state.plan.planned}`;
    $('loading-detail').textContent = state.retries ? `The archive is busy; retried ${state.retries} time${state.retries > 1 ? 's' : ''}. Frames play as they arrive.` : 'Frames play as they arrive.';
  }

  // status line (persistent, announced politely)
  let status = '';
  if (state.status === 'ready') {
    status = `${state.frames.length} frames loaded` + (state.failed ? `. ${state.failed} couldn't be downloaded (archive busy) — press Try again later to fill the gaps.` : '.');
  } else if (state.status === 'loading' && state.plan) status = `Loading ${state.frames.length} of ${state.plan.planned} frames…`;
  if ($('status').dataset.last !== status) { $('status').textContent = status; $('status').dataset.last = status; }

  // player controls
  const playable = n > 1;
  $('player').setAttribute('aria-disabled', n ? 'false' : 'true');
  for (const id of ['prev', 'next', 'play']) $(id).disabled = !playable;
  const scrub = $('scrub');
  scrub.disabled = !playable;
  scrub.max = String(Math.max(0, n - 1));
  scrub.value = String(Math.min(state.index, Math.max(0, n - 1)));
  $('play').innerHTML = state.playing ? ICON.pause : ICON.play;
  $('play').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');

  const cur = current(state);
  const label = !cur ? '—' : cur.kind === 'stack' ? fmtRange(cur.startDate, cur.endDate) : fmtDateTime(new Date(cur.date + 'Z'));
  $('when-date').textContent = label;
  $('when-count').textContent = n ? (cur?.kind === 'stack' ? `Season ${state.index + 1} of ${n} · ${cur.count} frames stacked` : `Frame ${state.index + 1} of ${n}`) : '';
  scrub.setAttribute('aria-valuetext', n ? `${label}, ${state.index + 1} of ${n}` : 'No frames');
  const first = list[0], last = list[n - 1];
  $('date-first').textContent = first ? fmtDate(first.kind === 'stack' ? first.startDate : new Date(first.date + 'Z')) : '';
  $('date-last').textContent = last && n > 1 ? fmtDate(last.kind === 'stack' ? last.endDate : new Date(last.date + 'Z')) : '';

  // facts
  const t = state.target;
  $('f-name').textContent = t ? (t.name || 'Coordinates') : '—';
  // where it is during the SPHEREx images (grid centre), not its catalogue (J2000) position
  const g = state.plan?.grid;
  const posNow = g ? { ra: g.ra0, dec: g.dec0 } : t;
  $('f-pos').textContent = t ? `${formatRA(posNow.ra)}  ${formatDec(posNow.dec)}` : '—';
  const pm = t ? Math.hypot(t.pmra || 0, t.pmdec || 0) : 0;
  $('f-motion').textContent = !t ? '—' : pm > 0 ? `${(pm / 1000).toFixed(pm > 1000 ? 2 : 3)}″ per year (${(pm / 1000 / 6.15).toFixed(2)} SPHEREx pixels)` : (t.source === 'coordinates' ? 'Fixed position' : 'Too small to see');
  // motion measured from the frames themselves (pixel shift -> RA/Dec -> straight-line fit)
  let meas = null;
  if (state.plan?.grid && state.frames.length >= 6 && pm > 0) {
    const key = state.requestId + ':' + state.frames.length;
    if (motionMemo.key !== key) motionMemo = { key, m: measureMotion(state.frames, state.plan.grid) };
    meas = motionMemo.m;
  }
  $('f-measured').textContent = !t || !(pm > 0) ? '—' : !meas ? (state.status === 'ready' ? 'Not enough frames' : 'Measuring when frames arrive…')
    : meas.ok ? `${(meas.total / 1000).toFixed(2)} ± ${(meas.totalErr / 1000).toFixed(2)}″ per year (SPHEREx, ${meas.frames} frames)` : `Too faint to measure in these frames (${meas.frames} clear detections)`;
  const vtCat = t ? tangentialVelocity(pm, t.plx) : null, vtMeas = meas?.ok && t ? tangentialVelocity(meas.total, t.plx) : null;
  $('f-vt').textContent = vtCat ? `${vtCat.toFixed(1)} km/s (SIMBAD motion + parallax)` + (vtMeas ? ` · ${vtMeas.toFixed(0)} km/s from SPHEREx` : '') : '—';
  $('f-rv').textContent = t && Number.isFinite(t.rv) ? `${t.rv > 0 ? '+' : ''}${t.rv.toFixed(1)} km/s (SIMBAD; ${t.rv < 0 ? 'coming towards us' : 'moving away'})` : '—';
  $('f-images').textContent = state.plan ? `${state.plan.total} (${fmtDate(state.plan.firstDate || new Date())} – ${fmtDate(state.plan.lastDate || new Date())})` : '—';
  const preset = t?.presetKey ? PRESETS.find(p => p.key === t.presetKey) : (state.query?.type === 'name' ? findPreset(state.query.name) : null);
  $('f-hint').hidden = !preset?.bandHint;
  $('f-hint').textContent = preset?.bandHint || '';
  document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-current', String(c.dataset.key === preset?.key)));

  $('g-date').textContent = cur ? label : '—';
  $('g-wave').textContent = cur?.kind === 'frame' && cur.wavelengthUm ? `${cur.wavelengthUm.toFixed(2)} µm` : cur?.kind === 'stack' ? 'Mixed (stack)' : '—';
  $('g-det').textContent = cur?.kind === 'frame' ? `${cur.detector} (${BANDS[cur.detector]})` : cur?.kind === 'stack' ? cur.detectors.join(', ') : '—';
  $('g-obs').textContent = cur?.obsid || '—';
  $('g-mask').textContent = cur?.kind === 'frame' ? String(cur.maskedPixels) : '—';
  $('g-ver').textContent = cur?.version || '—';
  $('g-grid').textContent = cur ? `${cur.n} × ${cur.n} px, 6.15″/px, north up` : '—';

  // scale bar: 1 arcmin
  const fov = state.settings.fov;
  $('scalebar').style.setProperty('--scalebar-width', `${(canvas.clientWidth / fov).toFixed(1)}px`);

  // image
  const drawKey = `${state.settings.stretch}|${state.settings.pixels}`;
  if (cur !== lastDrawn.item || drawKey !== lastDrawn.key) {
    drawFrame(canvas, cur, state.settings);
    lastDrawn = { item: cur, key: drawKey };
  }
  canvas.setAttribute('aria-label', cur
    ? `SPHEREx infrared image of ${t?.name || 'the chosen position'}, ${label}${cur.wavelengthUm ? `, wavelength ${cur.wavelengthUm.toFixed(2)} micrometres` : ''}. ${state.index + 1} of ${n}.`
    : 'No image yet');

  if (!store.get().playing && timer) stopTimer();
  // auto-play once everything is in (never for reduced-motion users); deferred so it
  // doesn't run inside this render pass
  if (prev && prev.status !== 'ready' && state.status === 'ready' && playable && !reducedMotion.matches && !state.playing) queueMicrotask(play);
}

store.subscribe((s, prev) => render(s, prev));
new ResizeObserver(() => drawFrame(canvas, current(store.get()), store.get().settings)).observe(canvas);

// ---------- sky map ----------
const skymap = new SkyMap($('skymap'), {
  onClick: (ra, dec) => openDetails(ra, dec, skymap.fov()),
  onHover: (data) => showTip(data),
});
let mapPos = { ra: 83.8221, dec: -5.3911, fov: 2.5 }; // Orion Nebula: bright in the infrared
let pointer = { x: 0, y: 0 };
$('viewer').addEventListener('pointermove', (e) => {
  const r = $('viewer').getBoundingClientRect();
  pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  if (!$('hover-tip').hidden) placeTip();
});
function placeTip() {
  const tip = $('hover-tip'), vw = $('viewer').clientWidth;
  tip.style.left = Math.max(4, Math.min(pointer.x + 14, vw - tip.offsetWidth - 4)) + 'px';
  tip.style.top = Math.max(4, pointer.y - tip.offsetHeight - 10) + 'px';
}
function showTip(data) {
  const tip = $('hover-tip');
  if (!data) { tip.hidden = true; return; }
  tip.textContent = data.name;
  const s = document.createElement('span');
  s.className = 'muted';
  s.textContent = data.type;
  tip.append(s);
  tip.hidden = false;
  placeTip();
}

async function mapSearch(query, push) {
  store.dispatch({ type: 'SEARCH', query });
  updateURL(push);
  try {
    const t = await resolveTarget(query);
    const p = (t.pmra || t.pmdec) ? propagate(t, 61360) : t; // where it is now (Nov 2026)
    mapPos = { ra: p.ra, dec: p.dec, fov: 0.5 };
    store.dispatch({ type: 'RESOLVED', requestId: store.get().requestId, target: t });
    await skymap.init(mapPos.ra, mapPos.dec, mapPos.fov);
    skymap.goTo(mapPos.ra, mapPos.dec, mapPos.fov);
    openDetails(p.ra, p.dec, mapPos.fov);
  } catch (e) {
    showQueryError(e.message);
  }
}

function applyMode() {
  const mode = store.get().settings.mode, map = mode === 'map';
  document.querySelectorAll('input[name=mode]').forEach(r => { r.checked = r.value === mode; });
  $('skymap').hidden = !map;
  canvas.hidden = map;
  $('mapbar').hidden = !map;
  $('bands-card').hidden = !map;
  $('player').hidden = map;
  document.querySelector('.overlay-tl').hidden = map;
  document.querySelector('.overlay-br').hidden = map;
  if (map) {
    pause();
    skymap.init(mapPos.ra, mapPos.dec, mapPos.fov).then(() => skymap.setChannel(store.get().settings.ch));
  } else {
    $('hover-tip').hidden = true;
    const s = store.get();
    if (s.query && !s.plan && s.status !== 'loading') search(s.query, { push: false });
    else drawFrame(canvas, current(s), s.settings);
  }
  render(store.get(), null);
}
document.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', (e) => setSetting('mode', e.target.value)));
$('wl').addEventListener('input', (e) => setSetting('ch', e.target.value));
$('map-film').addEventListener('click', () => { const c = skymap.center(); filmAt(c.ra, c.dec); });

function filmAt(ra, dec) {
  setSetting('mode', 'film');
  $('q').value = `${ra.toFixed(5)} ${dec >= 0 ? '+' : ''}${dec.toFixed(5)}`;
  $('details').hidden = true;
  search({ type: 'coords', ra, dec });
}

// time-lapse: click a spot on the image for its details
canvas.addEventListener('click', (e) => {
  const g = store.get().plan?.grid;
  if (!g) return;
  const r = canvas.getBoundingClientRect();
  const i = ((e.clientX - r.left) / r.width) * g.n - 0.5, j = ((e.clientY - r.top) / r.height) * g.n - 0.5;
  const [ra, dec] = gridToWorld(g, i, j);
  openDetails(ra, dec, (g.n * g.scale) / 3600);
});

// ---------- coordinate details ----------
let detailsCtl = null, detailsAt = null;
async function openDetails(ra, dec, fovDeg) {
  detailsCtl?.abort();
  detailsCtl = new AbortController();
  const signal = detailsCtl.signal;
  detailsAt = { ra, dec };
  $('details').hidden = false;
  $('d-static').innerHTML = await staticDetails(ra, dec, fovDeg);
  $('d-obs').innerHTML = observerHTML(ra, dec);
  $('d-cov').innerHTML = '<p class="muted">Asking IRSA…</p>';
  $('d-near').innerHTML = '<p class="muted">Asking SIMBAD…</p>';
  coverageHTML(ra, dec, { base: BASE, signal }).then(h => { if (!signal.aborted) $('d-cov').innerHTML = h; })
    .catch(() => { if (!signal.aborted) $('d-cov').innerHTML = '<p class="muted">IRSA did not answer. Try again in a moment.</p>'; });
  neighboursHTML(ra, dec, { signal }).then(h => { if (!signal.aborted) $('d-near').innerHTML = h; })
    .catch(() => { if (!signal.aborted) $('d-near').innerHTML = '<p class="muted">SIMBAD (the star catalogue) did not answer within 12 seconds. Close and click the spot again to retry.</p>'; });
}
$('details-close').addEventListener('click', () => { $('details').hidden = true; detailsCtl?.abort(); });
$('details-film').addEventListener('click', () => detailsAt && filmAt(detailsAt.ra, detailsAt.dec));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('details').hidden) $('details').hidden = true; });
function observerSet(msg) {
  $('obs-msg').textContent = msg;
  if (detailsAt) $('d-obs').innerHTML = observerHTML(detailsAt.ra, detailsAt.dec);
}
$('obs-geo').addEventListener('click', () => {
  if (!navigator.geolocation) { $('obs-msg').textContent = 'This browser cannot share a location. Type latitude, longitude instead.'; return; }
  $('obs-msg').textContent = 'Asking the browser…';
  navigator.geolocation.getCurrentPosition((p) => {
    setObserver({ lat: p.coords.latitude, lon: p.coords.longitude, label: 'your device location' });
    observerSet('Location set for this tab only. It is never saved or sent anywhere.');
  }, () => { $('obs-msg').textContent = 'Location not shared. You can type latitude, longitude instead.'; }, { maximumAge: 600000, timeout: 15000 });
});
$('obs-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const ll = parseLatLon($('obs-input').value);
  if (!ll) { $('obs-msg').textContent = 'Type latitude, longitude in degrees, e.g. 6.93, 79.85 (north and east are positive).'; return; }
  setObserver({ ...ll, label: 'the place you typed' });
  observerSet('Location set for this tab only. It is never saved or sent anywhere.');
});

// ---------- custom colour bands ----------
let bands = loadBands();
let editingBand = null;
function applyBands() {
  saveBands(bands);
  skymap.setBands(store.get().settings.bands === 'on' ? layersFor(bands) : []);
}
function renderBands() {
  const ul = $('band-list');
  ul.replaceChildren();
  for (const b of bands) {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = b.on; cb.setAttribute('aria-label', `Show ${b.name}`);
    cb.addEventListener('change', () => { b.on = cb.checked; applyBands(); });
    const sw = document.createElement('span'); sw.className = 'band-swatch'; sw.style.background = b.color; sw.setAttribute('aria-hidden', 'true');
    const nm = document.createElement('span'); nm.className = 'band-name';
    const t1 = document.createElement('span'); t1.textContent = b.name;
    const t2 = document.createElement('span'); t2.className = 'muted';
    t2.textContent = `${b.min.toFixed(2)}–${b.max.toFixed(2)} µm · ${channelsFor(b.min, b.max).length} colours · detector ${detectorsFor(b.min, b.max).join(', ')}`;
    nm.append(t1, t2);
    const act = document.createElement('span'); act.className = 'band-actions';
    const ed = document.createElement('button'); ed.type = 'button'; ed.className = 'btn'; ed.textContent = 'Edit'; ed.setAttribute('aria-label', `Edit ${b.name}`);
    ed.addEventListener('click', () => startEdit(b));
    const del = document.createElement('button'); del.type = 'button'; del.className = 'btn'; del.textContent = 'Delete'; del.setAttribute('aria-label', `Delete ${b.name}`);
    del.addEventListener('click', () => { bands = bands.filter(x => x !== b); if (editingBand === b) cancelEdit(); applyBands(); renderBands(); });
    act.append(ed, del);
    li.append(cb, sw, nm, act);
    ul.append(li);
  }
  if (!bands.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'No bands yet. Add one below, or reset to the defaults.'; ul.append(li); }
}
function bandError(msg) { $('band-error').textContent = msg || ''; $('band-error').hidden = !msg; }
function startEdit(b) {
  editingBand = b;
  const f = $('band-form');
  f.name.value = b.name; f.min.value = b.min; f.max.value = b.max; f.color.value = b.color;
  $('band-form-title').textContent = `Edit "${b.name}"`;
  $('band-save').textContent = 'Save changes';
  $('band-cancel').hidden = false;
  bandError('');
  f.name.focus();
}
function cancelEdit() {
  editingBand = null;
  $('band-form').reset();
  $('band-form-title').textContent = 'Add a band';
  $('band-save').textContent = 'Add band';
  $('band-cancel').hidden = true;
  bandError('');
}
$('band-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const clean = validateBand({ name: f.name.value, min: f.min.value, max: f.max.value, color: f.color.value }, bands, editingBand?.id);
    if (editingBand) Object.assign(editingBand, clean);
    else bands.push({ id: 'u' + Date.now().toString(36), ...clean, on: true });
    cancelEdit();
    renderBands();
    if (store.get().settings.bands !== 'on') setSetting('bands', 'on'); else applyBands();
  } catch (err) {
    if (err instanceof BandError) bandError(err.message); else throw err;
  }
});
$('band-cancel').addEventListener('click', cancelEdit);
$('band-reset').addEventListener('click', () => { bands = resetBands(); cancelEdit(); applyBands(); renderBands(); });
$('bands-on').addEventListener('change', (e) => setSetting('bands', e.target.checked ? 'on' : 'off'));
renderBands();

// ---------- offline + history ----------
function onlineState() { $('offline').hidden = navigator.onLine; }
addEventListener('online', onlineState);
addEventListener('offline', onlineState);
onlineState();

function loadFromURL(push) {
  const { query, settings } = fromURL(location.search);
  for (const [k, v] of Object.entries(settings)) store.dispatch({ type: 'SET_SETTING', key: k, value: v });
  syncSettingsForm(settings);
  $('wl').value = String(settings.ch); $('wl-out').textContent = `${CHANNEL_UM[settings.ch].toFixed(2)} µm`;
  $('bands-on').checked = settings.bands === 'on';
  applyMode();
  applyBands();
  if (query) {
    $('q').value = query.type === 'name' ? query.name : `${query.ra.toFixed(5)} ${query.dec >= 0 ? '+' : ''}${query.dec.toFixed(5)}`;
    search(query, { push });
  } else {
    controller?.abort();
    store.dispatch({ type: 'RESET' });
    render(store.get(), null);
  }
}
addEventListener('popstate', () => loadFromURL(false));
loadFromURL(false);
