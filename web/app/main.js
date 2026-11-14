// Wires the page to the state store, the data pipeline and the canvas renderer.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { parseQuery, QueryError, fromURL, toURL, formatRA, formatDec, validSetting } from './query.js';
import { createStore, reducer, initialState } from './state.js';
import { run, buildStacks, BANDS } from './data.js';
import { drawFrame } from './render.js';
import { PRESETS, findPreset } from './presets.js';

const $ = (id) => document.getElementById(id);
const BASE = location.origin; // the local server relays IRSA/Gaia on the same origin
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
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
    b.addEventListener('click', () => { $('q').value = p.label; showQueryError(''); search({ type: 'name', name: p.label }); });
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
function showState(name) {
  for (const id of ['idle', 'loading', 'empty', 'error']) $('state-' + id).hidden = id !== name;
}

function render(state, prev) {
  const list = items(state);
  const n = list.length;
  const busy = ['resolving', 'listing', 'loading'].includes(state.status);

  // overlay states
  if (state.status === 'idle') showState('idle');
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
  const label = !cur ? '—' : cur.kind === 'stack' ? `${fmtDate(cur.startDate)} – ${fmtDate(cur.endDate)}` : fmtDateTime(new Date(cur.date + 'Z'));
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

// ---------- offline + history ----------
function onlineState() { $('offline').hidden = navigator.onLine; }
addEventListener('online', onlineState);
addEventListener('offline', onlineState);
onlineState();

function loadFromURL(push) {
  const { query, settings } = fromURL(location.search);
  for (const [k, v] of Object.entries(settings)) store.dispatch({ type: 'SET_SETTING', key: k, value: v });
  syncSettingsForm(settings);
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
