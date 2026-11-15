// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// "Spot a mover" page (DESIGN.md 34): pick a field, blink its first season against its latest,
// click up to five suspects, and let four checks explain them (or not). Browser only; the pure
// rules live in ./logic.js and the network checks in ./checks.js.
// Images come through the viewer's own pipeline (data.js planImages / loadFrame / buildStacks)
// with the viewer's settings, so the relay's disk cache is shared.

import { planImages, gridFor, loadFrame, buildStacks, seasons as groupSeasons } from '../data.js';
import { mapLimit } from '../../core/irsa.js';
import { gridToWorld, worldToGrid } from '../../core/align.js';
import { propagate, separationArcsec } from '../../core/motion.js';
import { fmtArc } from '../../core/ghost.js';
import { parseQuery, formatRA, formatDec } from '../query.js';
import { initClarity, showPop, closePop, resolve, updateNav, esc } from '../archive/shell.js';
import { notebookAdd, openNotebook } from '../notebook/notebook.js';
import {
  LOAD_SETTINGS, MAX_SUSPECTS, QUICK, fieldByKey, pickSurprise, nearestField, fmtDay, seasonRange, fmtPos,
  ARTEFACT_KINDS, flagsAtSpot, evaluateFlags, decideSeasons, seasonPresence, STATE_WORD, checkTitle,
  initChecklist, checklistStep, decideVerdict, ASTEROID_HALF_WIDTH_DEG, offsetText, fieldCentre, passDistance,
  plainCheckText, simpleBodyName, parseClick, STAR_MATCH_ARCSEC, ASTEROID_MATCH_ARCSEC, dotAt, wingPeak, separatePeaks, fieldBand, framesForField, STAR_TIE_ARCSEC,
  PIXEL_ARCSEC, starLabel,
} from './logic.js';
import { fetchFieldStars, starCheckAt, fetchFieldAsteroids, asteroidCheckAt } from './checks.js';
import { measureColour, colourEstimate, colourLines, withColour, ratioText, COLOUR_LABEL, AP_PX, COLOUR_GROUPS } from './colour.js'; // 5th check: supporting evidence only
import { pickTip, fitPlaceholder } from '../picktips.js'; // chip tips (NASA's challenge targets), search placeholder
import { isExpert } from '../expert.js'; // Simple / Expert: .x-only and .s-only twins below
import { BOTHA_KEY, BOTHA_URL, bothaFrames, bothaGrid, bothaColour, bothaCard } from './botha.js'; // "Known asteroid" example: one night
import { spotSnrMeasure, spotSnrRender } from '../snr-ui.js'; // spec A: signal-to-noise line on the verdict card
import { buildReport, reportMarkdown, bywText, mpcNotes, reportFileName, HOW_TO, CAVEAT } from './report.js'; // extra 4: "Report this find"

// Both twins in the page; CSS from expert.js shows one. Identical texts render once.
const twin = (simple, expert) => (simple === expert ? expert : `<span class="s-only">${simple}</span><span class="x-only">${expert}</span>`);

const $ = (id) => document.getElementById(id);
const R = window.MockRender;
const BASE = location.origin;
const root = document.documentElement;
const reduce = () => root.dataset.motion === 'reduce';

let tables = null;
const tablesReady = fetch('core/data/spectral_wcs.json').then(r => r.json()).then(t => { tables = t; }).catch(() => {});

// The viewer's stretch and colour scale (shared Clarity storage; defaults as in ui.js).
function viewSettings() {
  let s = {}; try { s = JSON.parse(localStorage.getItem('tgi-clarity-v1')) || {}; } catch { /* private mode */ }
  return { str: s.str || 'auto', ramp: s.ramp || 'copper' };
}

const S = {
  field: null, target: null, grid: null, frames: [], stacks: [], seasonFrames: [], allSeasons: [], band: null, ready: false, ctl: null,
  show: 0, blinking: true, timer: null, suspects: [], sel: null, loaded: 0, planned: 0, failed: 0,
};
const lastIdx = () => S.stacks.length - 1;
const blinked = () => [S.stacks[0], S.stacks[lastIdx()]];

/* ------------------------------------------------------------------ screen-reader announcements
   AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
   The verdict card and the checks list are re-rendered on every update (and the asteroid timer ticks each
   second), so they are not live regions; only one short verdict line is announced, and only when it changes. */
$('verdict').removeAttribute('aria-live'); $('lines').removeAttribute('aria-live');
const verdictLive = Object.assign(document.createElement('p'), { className: 'sr-only', id: 'verdictLive' });
verdictLive.setAttribute('aria-live', 'polite'); verdictLive.setAttribute('aria-atomic', 'true');
$('side').append(verdictLive);
function announceVerdict(text) { if (verdictLive.textContent !== text) verdictLive.textContent = text; }

/* ------------------------------------------------------------------ toast */
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); }

/* ------------------------------------------------------------------ field picker */
function buildPicker() {
  $('quick').innerHTML = QUICK.map(f => { const t = esc(pickTip(f.key)); return `<button class="key pick" type="button" data-key="${f.key}" title="${t}" aria-description="${t}">${esc(f.label)}</button>`; }).join('');
  fitPlaceholder($('q'));
  for (const b of $('quick').querySelectorAll('button')) b.onclick = () => choose(fieldByKey(b.dataset.key));
  $('surprise').onclick = () => choose(pickSurprise(S.field?.key));
}
function choose(f, push = true) {
  if (!f) return;
  if (push) S.pendingClick = null; // a field picked by hand gets no example click
  if (push) history.pushState(null, '', '?field=' + encodeURIComponent(f.key));
  loadField(f);
}
function foldPick(fold) {
  $('pick').classList.toggle('folded', fold); $('pChange').setAttribute('aria-expanded', String(!fold));
  if (S.field) $('pfName').textContent = S.field.label;
}
$('pChange').onclick = () => { foldPick(false); $('pick').querySelector('.sm-picks button')?.focus(); };
function markPicks() {
  for (const b of $('quick').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.key === S.field?.key));
}

/* ------------------------------------------------------------------ loading a field */
function showState(big, txt, keys = []) {
  const st = $('state');
  if (big == null) { st.hidden = true; return; }
  st.hidden = false; $('stateBig').textContent = big; $('stateTxt').textContent = txt || '';
  const k = $('stateKeys'); k.innerHTML = '';
  for (const [label, fn] of keys) { const b = document.createElement('button'); b.className = 'key'; b.type = 'button'; b.textContent = label; b.onclick = fn; k.append(b); }
}
function progress() {
  const p = S.planned ? S.loaded / S.planned : 0;
  $('line').hidden = S.ready; $('lineFill').style.width = (p * 100).toFixed(1) + '%';
  if (!S.ready) $('stateTxt').innerHTML = `<span class="num">${S.loaded}</span> of <span class="num">${S.planned}</span> images in${S.failed ? ` · ${S.failed} not fetched (IRSA busy)` : ''}`;
}
function fieldTitle(f) { return f.label; }

// Live loads give up (judging panel a10) when IRSA sends nothing new for STALL_MS, or after
// BUSY_503 "busy" answers once STALL_MS has passed. The demo fields answer from web/prebaked/ at once.
const STALL_MS = 18000, BUSY_503 = 30; // 18 s: the message is up within 20 s of a blocked archive
function watchdog(ctl, onGiveUp) {
  const t0 = Date.now(); let last = t0, busy = 0;
  const dog = { timedOut: false, progress() { last = Date.now(); }, busy() { busy++; }, stop() { clearInterval(h); } };
  const h = setInterval(() => {
    if (ctl.signal.aborted || S.ctl !== ctl) return dog.stop();
    const now = Date.now();
    if (now - last >= STALL_MS || (busy >= BUSY_503 && now - t0 >= STALL_MS)) { dog.stop(); dog.timedOut = true; ctl.abort(); onGiveUp(); }
  }, 500);
  return dog;
}
// The archive stopped answering: Retry, and keep the images already in when they span two seasons.
function archiveDown(f, frames) {
  $('line').hidden = true;
  const got = frames.slice().sort((a, b) => a.mjd - b.mjd);
  const usable = got.length && groupSeasons(got).length >= 2;
  const keys = [['Retry', () => loadField(f)]];
  if (usable) keys.push([`Use the ${got.length} images loaded`, () => finishField(f, got, true)]);
  showState('The NASA archive isn\'t answering',
    got.length ? `${got.length} of ${S.planned} images came in, then IRSA went quiet. It is often busy; Retry asks again.${usable ? '' : ' The images so far are all from one season, too few to blink.'}`
      : `IRSA sent nothing for ${STALL_MS / 1000} seconds. It is often busy; Retry asks again.`, keys);
}

async function loadField(f) {
  S.ctl?.abort(); const ctl = S.ctl = new AbortController();
  const frames = [];
  const dog = watchdog(ctl, () => archiveDown(f, frames));
  stopBlink(); bothaMode(false); clearSuspects();
  Object.assign(S, { field: f, target: f.target, grid: null, frames: [], stacks: [], seasonFrames: [], allSeasons: [], band: null, ready: false, loaded: 0, planned: 0, failed: 0, show: 0 });
  $('fBand').hidden = true; $('fBand').textContent = '';
  markPicks(); $('pickNote').textContent = ''; foldPick(true);
  $('fName').textContent = fieldTitle(f);
  const now = propagate(f.target, Date.now() / 86400000 + 40587);
  $('fCoords').textContent = `Field centre now: ${formatRA(now.ra)} ${formatDec(now.dec)}`;
  // a surprise patch keeps its secret: the other pages get coordinates, not the star's name
  if (f.key.startsWith('s-')) updateNav({ type: 'coords', ra: now.ra, dec: now.dec });
  else updateNav(f.query || { type: 'name', name: f.target.name });
  $('chip').textContent = ''; $('flag').textContent = '';
  const cv = $('cv'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  showState(`Finding SPHEREx images of ${fieldTitle(f).replace(/^A patch/, 'this patch')}`, 'Asking the archive for its image list…');
  steps();
  await tablesReady;
  let plan;
  try { plan = await planImages(f.target, LOAD_SETTINGS, { base: BASE, signal: ctl.signal }); }
  catch (e) {
    dog.stop();
    if (ctl.signal.aborted) return; // a newer field, or the watchdog (which shows its own message)
    showState('The NASA archive isn\'t answering', 'IRSA is often busy. Retry asks again.', [['Retry', () => loadField(f)]]);
    return;
  }
  if (ctl.signal.aborted) return;
  dog.progress();
  const chosen = plan.chosen;
  if (!chosen.length) { dog.stop(); showState('No SPHEREx images cover this spot', 'Try one of the fields above.'); return; }
  const planSeasons = groupSeasons(chosen.map(im => ({ mjd: im.mjdStart })));
  if (planSeasons.length < 2) { dog.stop(); return oneSeason(f); }
  S.grid = gridFor(f.target, chosen, LOAD_SETTINGS.fov);
  S.planned = chosen.length; progress();
  showState(`Loading ${chosen.length} images in ${planSeasons.length} seasons`, '');
  progress();
  await mapLimit(chosen, 8, async (im) => {
    if (ctl.signal.aborted) return;
    try { frames.push(await loadFrame(im, f.target, S.grid, LOAD_SETTINGS, { base: BASE, signal: ctl.signal, tables, onRetry: dog.busy })); S.loaded++; dog.progress(); }
    catch (e) { if (!ctl.signal.aborted) S.failed++; }
    if (!ctl.signal.aborted) progress();
  });
  dog.stop();
  if (ctl.signal.aborted) return;
  finishField(f, frames);
}
// Stacks the loaded images and starts the blink. `partial`: the user chose to go on with the images
// that came in before IRSA went quiet.
function finishField(f, frames, partial = false) {
  if (S.field !== f) return;
  frames.sort((a, b) => a.mjd - b.mjd);
  if (partial) { S.loaded = frames.length; S.failed = S.planned - frames.length; }
  // WISE 0855 is blinked on detectors 5–6 only (logic.js fieldBand); JPL is still asked at each season's
  // middle image of ALL loaded images, the request web/prebaked/ holds (tools/export_prebaked.mjs spot()).
  S.allSeasons = groupSeasons(frames);
  const use = framesForField(frames, fieldBand(f), groupSeasons);
  S.band = use.band;
  $('fBand').textContent = S.band ? S.band.text + '.' : ''; $('fBand').hidden = !S.band;
  S.frames = use.frames;
  S.seasonFrames = groupSeasons(use.frames);
  if (S.seasonFrames.length < 2) {
    if (S.failed) { showState('Too few images arrived', `${S.loaded} of ${S.planned} images came in; IRSA is busy. Retry asks again.`, [['Retry', () => loadField(f)]]); return; }
    return oneSeason(f);
  }
  const st = buildStacks(S.frames);
  S.stacks = st.map((s, i) => ({ ...s, label: i === 0 ? 'First season' : i === st.length - 1 ? 'Latest season' : `Season ${i + 1}`,
    F: { d: Array.from(s.data, v => (Number.isFinite(v) ? v : null)) },
    frames: S.seasonFrames[i].frames }));
  S.ready = true; progress(); showState(null);
  fieldStars(); fieldAsteroids(); // ask the catalogues and JPL for the whole patch now, before any click
  if (S.failed) toast(`${S.loaded} images are in. ${S.failed} couldn't be fetched (IRSA busy).`);
  S.show = 0; startBlink(); layout(); steps();
  placeClick();
}
function oneSeason(f) {
  const c = propagate(f.target, 61000), near = nearestField(c.ra, c.dec);
  showState('This patch has only one SPHEREx season so far', `A mover needs two seasons to compare. The nearest field with two or more is ${near.field.label}.`,
    [[`Try ${near.field.label}`, () => choose(near.field)]]);
  $('pickNote').textContent = 'That patch has one season so far; pick another.'; foldPick(false);
}

/* ------------------------------------------------------------------ blink + drawing */
let cssCell = 16;
function layout() {
  if (!S.grid) return;
  const box = $('screen'), n = S.grid.n;
  cssCell = Math.max(3, Math.floor(Math.min(box.clientWidth, box.clientHeight) / n));
  const cv = $('cv'); cv.style.width = cv.style.height = (n * cssCell) + 'px';
  cv.dataset.dev = Math.max(1, Math.round(cssCell * (devicePixelRatio || 1)));
  $('sbar').style.width = (cssCell * 30 / 6.15) + 'px';
  draw();
}
new ResizeObserver(() => layout()).observe($('screen'));

function draw() {
  if (!S.ready) return;
  const cv = $('cv'), n = S.grid.n, k = +cv.dataset.dev, vs = viewSettings();
  const st = S.show ? S.stacks[lastIdx()] : S.stacks[0];
  R.draw(cv, st.F, n, { ramp: vs.ramp, cell: k, ring: false, stretch: vs.str, maskBg: '#211b16', maskInk: '#6b5d50' });
  const c = cv.getContext('2d');
  // a known mover's predicted place in this season (Ghost style: hollow ivory ring, DESIGN.md 24)
  const sel = selected(), star = sel?.lines?.star;
  if (star?.mover && star.best) {
    const p = propagate(star.best, st.mjd), [gx, gy] = worldToGrid(S.grid, p.ra, p.dec);
    c.save(); c.strokeStyle = 'rgba(255,246,232,.8)'; c.lineWidth = Math.max(1.5, k / 10); c.setLineDash([k * .3, k * .25]);
    c.beginPath(); c.arc((gx + .5) * k, (gy + .5) * k, 1.1 * k, 0, Math.PI * 2); c.stroke(); c.restore();
  }
  for (const s of S.suspects) ring(c, s, k, s.id === S.sel);
  if (S.botha && st.predicted) { // JPL's predicted place at this image's time (Ghost style: hollow dashed ivory ring)
    c.save(); c.strokeStyle = 'rgba(255,246,232,.85)'; c.lineWidth = Math.max(1.5, k / 10); c.setLineDash([k * .3, k * .25]);
    c.beginPath(); c.arc((st.predicted.x + .5) * k, (st.predicted.y + .5) * k, 1.6 * k, 0, Math.PI * 2); c.stroke(); c.restore();
  }
  if (S.botha) {
    $('chip').innerHTML = `<b>${esc(st.label)}</b><span class="sep">·</span><span>one image, ${esc(st.wl.toFixed(2))} µm</span>`;
    $('flag').textContent = `14 Dec 2025 · ${st.utc.slice(11, 19)} UTC`;
    cv.setAttribute('aria-label', `${st.label}: one SPHEREx image of 14 Dec 2025 at ${st.utc.slice(11, 19)} UTC, ${st.wl.toFixed(2)} µm. A dashed ring marks where JPL predicts asteroid 1354 Botha at that time.`);
    return segs();
  }
  $('chip').innerHTML = `<b>${esc(st.label)}</b><span class="sep">·</span><span>stacked, ${st.count} images</span>${S.band ? `<span class="sep">·</span><span>${esc(S.band.um)} only</span>` : ''}`;
  $('flag').textContent = seasonRange(st);
  cv.setAttribute('aria-label', `${st.label} of ${S.field.label}, stacked from ${st.count} SPHEREx images, ${seasonRange(st)}. ${S.suspects.length} suspects marked.`);
  segs();
}
function ring(c, s, k, on) {
  const x = (s.x + .5) * k, y = (s.y + .5) * k, r = 1.6 * k;
  c.save();
  c.lineWidth = Math.max(on ? 2.5 : 1.75, k / (on ? 7 : 10));
  c.strokeStyle = 'rgba(11,9,7,.8)'; c.beginPath(); c.arc(x, y, r + c.lineWidth * .6, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = '#E3A86B'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
  const fs = Math.max(11, Math.round(k * .8)); c.font = `600 ${fs}px "IBM Plex Mono", monospace`;
  const tx = x + r * .75, ty = y - r * .75, w = c.measureText(String(s.n)).width + fs * .7;
  c.fillStyle = on ? '#E3A86B' : 'rgba(21,17,14,.86)'; c.beginPath(); c.roundRect(tx, ty - fs * .65, w, fs * 1.3, fs * .4); c.fill();
  c.fillStyle = on ? '#15110E' : '#FFF6E8'; c.textBaseline = 'middle'; c.fillText(String(s.n), tx + fs * .35, ty);
  c.restore();
}
function setShow(v) { S.show = v; draw(); }
function segs() { $('showA').setAttribute('aria-pressed', String(S.show === 0)); $('showB').setAttribute('aria-pressed', String(S.show === 1)); }
function startBlink() {
  stopBlink(); S.blinking = true;
  S.timer = setInterval(() => { S.show ^= 1; draw(); }, reduce() ? 1500 : 600);
  $('blinkBtn').textContent = 'Pause blink'; $('blinkBtn').setAttribute('aria-pressed', 'true');
}
function stopBlink() {
  clearInterval(S.timer); S.timer = null; S.blinking = false;
  $('blinkBtn').textContent = 'Play blink'; $('blinkBtn').setAttribute('aria-pressed', 'false');
}
$('blinkBtn').onclick = () => (S.blinking ? stopBlink() : (S.ready && startBlink()));
$('showA').onclick = () => { stopBlink(); setShow(0); };
$('showB').onclick = () => { stopBlink(); setShow(1); };
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, [role=dialog], dialog') || e.metaKey || e.ctrlKey || e.altKey || !S.ready) return;
  const onKey = e.target.closest?.('button, a, summary, pre');
  if (e.key === ' ' && !onKey) { e.preventDefault(); S.blinking ? stopBlink() : startBlink(); }
  else if (e.key === '1' || (e.key === 'ArrowLeft' && !onKey)) { stopBlink(); setShow(0); }
  else if (e.key === '2' || (e.key === 'ArrowRight' && !onKey)) { stopBlink(); setShow(1); }
  else if (e.key === 'b' || e.key === 'B') S.blinking ? stopBlink() : startBlink();
});

/* ------------------------------------------------------------------ suspects */
const selected = () => S.suspects.find(s => s.id === S.sel) || null;
let nextId = 1;
// Numbers stay stable: removing suspect 2 leaves 1 and 3, and the next click takes the lowest free number.
// A removed suspect takes its checks, verdict and report summary with it (late answers are dropped in settle).
function clearSuspects() { for (const s of S.suspects) s.token = null; S.suspects = []; S.sel = null; $('sum').textContent = ''; renderSide(); }
$('clearAll').onclick = (e) => {
  const n = S.suspects.length; if (!n) return;
  clearSuspects(); draw(); steps();
  toast(n === 1 ? 'Suspect removed.' : `All ${n} suspects removed.`);
  const empty = $('susEmpty'); // keyboard (detail 0) keeps the ring; a mouse click does not
  empty.classList.toggle('quiet', e.detail > 0);
  empty.addEventListener('blur', () => empty.classList.remove('quiet'), { once: true });
  empty.focus();
};
$('cv').addEventListener('click', (e) => {
  if (!S.ready) return;
  if (S.botha) { toast('This example is fixed: the dashed ring is JPL\'s predicted place. Pick a field above to click your own.'); return; }
  const r = $('cv').getBoundingClientRect();
  const x = (e.clientX - r.left) / cssCell - .5, y = (e.clientY - r.top) / cssCell - .5;
  const hit = S.suspects.find(s => Math.hypot(s.x - x, s.y - y) <= 1.6);
  if (hit) { select(hit.id); return; }
  if (S.suspects.length >= MAX_SUSPECTS) { toast('Up to five suspects per field. Remove one to add another.'); return; }
  addSuspect(+x.toFixed(2), +y.toFixed(2));
});
function addSuspect(x, y) {
  const used = new Set(S.suspects.map(s => s.n)); let n = 1; while (used.has(n)) n++;
  const [ra, dec] = gridToWorld(S.grid, x, y);
  // the peak the click belongs to, in the season on screen (judging panel A4 + Master's rule): the dot
  // under it (measured centre), else the top of the glow it sits on; the catalogue is matched to that
  // as well as to the ring. Neither: the ring alone.
  const k = S.show ? 1 : 0, d = dotAt(blinked()[k], x, y) || wingPeak(blinked()[k], x, y);
  const dot = d ? (([dra, ddec]) => ({ ra: dra, dec: ddec, x: d.x, y: d.y, snr: d.snr, part: !!d.part, k }))(gridToWorld(S.grid, d.x, d.y)) : null;
  const s = { id: nextId++, n, x, y, ra, dec, on: k, dot, check: initChecklist(), lines: {}, verdict: null, token: null };
  S.suspects.push(s); S.suspects.sort((a, b) => a.n - b.n);
  select(s.id); openSheet();
  runChecks(s);
}
function select(id) { S.sel = id; draw(); renderSide(); steps(); }
function removeSuspect(id, refocus = false) {
  const i = S.suspects.findIndex(q => q.id === id); if (i < 0) return;
  const s = S.suspects[i]; s.token = null;
  S.suspects = S.suspects.filter(q => q.id !== id);
  if (S.sel === id) { S.sel = S.suspects[0]?.id ?? null; $('sum').textContent = ''; }
  draw(); renderSide(); steps();
  toast(`Suspect ${s.n} removed.`);
  if (refocus) { // keyboard: keep focus in the list (the next row, else the previous, else the empty note)
    const next = S.suspects[Math.min(i, S.suspects.length - 1)];
    (next ? $('sus').querySelector(`[data-id="${next.id}"]`) : $('susEmpty')).focus();
  }
}
// Delete (or Backspace) on a focused suspect row, or on its ✕, removes that suspect.
$('sus').addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const b = e.target.closest('[data-id], [data-rm]'); if (!b) return;
  e.preventDefault(); removeSuspect(+(b.dataset.id || b.dataset.rm), true);
});

/* ------------------------------------------------------------------ the checks */
// The middle image of a season (its real UTC time goes to JPL).
function middleImage(stack) {
  const fs = stack.frames; let b = fs[0];
  for (const f of fs) if (Math.abs(f.mjd - stack.mjd) < Math.abs(b.mjd - stack.mjd)) b = f;
  return b;
}
// All four checks start at once (lead, after the Design run): the quick ones settle in a moment,
// JPL in about a minute (90 s budget). The verdict shows as soon as the checks so far decide it.
function runChecks(s, retryId) {
  s.check = retryId ? checklistStep(s.check, { type: 'retry', id: retryId }) : checklistStep(s.check, { type: 'start' });
  const ids = retryId ? [retryId] : ['flags', 'star', 'asteroid', 'seasons'];
  s.gen = s.gen || {}; const my = {}; for (const id of ids) my[id] = s.gen[id] = {};
  const [A, B] = blinked();
  const at = { ra: s.ra, dec: s.dec };
  const epochs = [{ mjd: A.mjd, label: 'First season' }, { mjd: B.mjd, label: 'Latest season' }];
  const settle = (id, res) => {
    if (s.gen[id] !== my[id] || !S.suspects.includes(s)) return; // removed, or a newer run of this check
    s.lines[id] = res;
    s.check = checklistStep(s.check, { type: 'done', id, status: res.status, text: res.text, data: res });
    update(s);
  };
  const seasonsNow = () => {
    const mover = s.lines.star?.mover ? s.lines.star.best : null;
    return decideSeasons(seasonPresence(S.stacks, (i) => {
      const pts = [[s.x, s.y]];
      if (mover) { const p = propagate(mover, S.stacks[i].mjd); pts.push(worldToGrid(S.grid, p.ra, p.dec)); }
      return pts;
    }));
  };
  update(s);
  if (my.flags) setTimeout(() => settle('flags', evaluateFlags([A, B].map((st, i) => ({ label: epochs[i].label, frames: st.frames })), s.x, s.y)), reduce() ? 0 : 150);
  if (my.star) {
    fieldStars(retryId === 'star').p.then(cat => starCheckAt(cat, at, epochs, s.dot, { separate: separateFrom(s) }))
      .catch(e => ({ status: 'failed', text: `The star catalogues did not answer (${e.message}).`, near: [] }))
      .then(res => { settle('star', res); if (my.seasons) settle('seasons', seasonsNow()); if (s.gen.star === my.star) runColour(s); }); // seasons and colour use a known mover's predicted places
  } else if (my.seasons) setTimeout(() => settle('seasons', seasonsNow()), 0);
  if (my.asteroid) {
    const fa = fieldAsteroids(retryId === 'asteroid'); s.astStart = fa.t0;
    fa.p.then(results => asteroidCheckAt(results, at))
      .catch(e => ({ status: 'failed', text: `Could not ask JPL (${e.message}).`, results: [] }))
      .then(res => settle('asteroid', res));
  }
}
// ---- 5th check, "Colour (estimate)" (colour.js): supporting evidence only, never the verdict.
// The season's images of ALL detectors (WISE 0855 is blinked on 5–6 only, but its colour needs 1–6).
const allOf = (stack) => S.allSeasons.find(g => g.frames.includes(stack.frames[0]))?.frames || stack.frames;
function runColour(s) {
  if (!S.suspects.includes(s)) return;
  try {
    const B = blinked(), k = s.dot ? s.dot.k : (S.show ? 1 : 0);
    const p0 = s.dot ? { x: s.dot.x, y: s.dot.y } : { x: s.x, y: s.y };
    const mover = s.lines.star?.mover ? s.lines.star.best : null;
    // the dot's place in the other blinked season: moved with a known mover's catalogue motion, then its dot there (within 1 px)
    const placeIn = (j) => {
      if (j === k) return p0;
      let q = p0;
      if (mover) {
        const a = propagate(mover, B[k].mjd), b = propagate(mover, B[j].mjd), [ax, ay] = worldToGrid(S.grid, a.ra, a.dec), [bx, by] = worldToGrid(S.grid, b.ra, b.dec);
        q = { x: p0.x + bx - ax, y: p0.y + by - ay };
      }
      const d = dotAt(B[j], q.x, q.y);
      return d && Math.hypot(d.x - q.x, d.y - q.y) <= 1 ? d : q;
    };
    s.colour = colourEstimate([k, 1 - k].map(j => { const p = placeIn(j); return { label: j ? 'latest season' : 'first season', rows: measureColour(allOf(B[j]), p.x, p.y).rows }; }));
    s.colour.blend = blendWith(s);
  } catch (e) { s.colour = null; console.warn('Colour estimate failed:', e); }
  update(s);
}
// A catalogued star (not the one named) inside the measuring circle: the colour is a blend of both.
function blendWith(s) {
  const st = s.lines.star; if (!st?.near) return null;
  const r = AP_PX * PIXEL_ARCSEC, best = st.best;
  const k = st.dot ? st.dot.k : 0, same = (m) => best && m.pos?.[k] && best.pos?.[k] && separationArcsec(m.pos[k].ra, m.pos[k].dec, best.pos[k].ra, best.pos[k].dec) <= STAR_TIE_ARCSEC; // the same star again in the other catalogue
  return st.near.find(m => m !== best && Number.isFinite(m.ref) && m.ref <= r && !same(m)) || null;
}

// Master's rule: a catalogue entry near the ring does not explain a clicked dot that is its own peak with
// a real dip between it and the entry's place (logic.js separatePeaks), in the season the dot was measured.
function separateFrom(s) {
  if (!s.dot || s.dot.part) return null;
  const st = blinked()[s.dot.k];
  return (m) => { const p = m.pos?.[s.dot.k]; if (!p) return false; const [gx, gy] = worldToGrid(S.grid, p.ra, p.dec); return separatePeaks(st, s.dot, { x: gx, y: gy }); };
}
// Field-level lookups (lead, for the prebaked demo): Gaia + SIMBAD once per patch, JPL once per patch
// and season, started when the field loads and matched locally for every ring. Kept in memory; a
// lookup that failed is dropped when it settles, so the next ring (or Retry) asks again.
const FIELD = new Map(); // key -> { t0, p }
function fieldLookup(key, make, force) {
  if (force) FIELD.delete(key);
  let e = FIELD.get(key);
  if (!e) { e = { t0: Date.now(), p: make() }; FIELD.set(key, e); e.p.then(r => { if (r?.failed && FIELD.get(key) === e) FIELD.delete(key); }, () => FIELD.delete(key)); }
  return e;
}
function fieldStars(force) {
  const c = fieldCentre(S.grid);
  return fieldLookup(`stars|${c.ra},${c.dec}`, () => fetchFieldStars({ centre: c, base: BASE })
    .catch(e => ({ gaia: { ok: false, error: e.message }, simbad: { ok: false, error: e.message } }))
    .then(r => { presetNames(r.simbad?.stars); return Object.assign(r, { failed: !r.gaia.ok || !r.simbad.ok }); }), force);
}
// SIMBAD's main_id can differ only in case from the field's own name ('Barnard's star'): use the
// preset / catalogue label as given (Design review 2, item 5). Names only, never positions or motions.
function presetNames(stars) {
  const norm = (x) => String(x || '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const labels = [S.field?.label, S.target?.name, ...QUICK.map(f => f.label)].filter(Boolean);
  for (const st of stars || []) { const hit = labels.find(l => norm(l) === norm(st.name)); if (hit) st.name = hit; }
}
function fieldAsteroids(force) {
  const c = fieldCentre(S.grid);
  const all = S.allSeasons.length >= 2 ? [S.allSeasons[0], S.allSeasons[S.allSeasons.length - 1]] : [];
  const parts = (all.length ? all.map(g => ({ frames: g.frames, mjd: g.frames.reduce((a, f) => a + f.mjd, 0) / g.frames.length })) : blinked()).map((st, i) => {
    const f = middleImage(st), season = { label: i ? 'Latest season' : 'First season', mjd: f.mjd, utc: f.date, obsid: f.obsid };
    return fieldLookup(`jpl|${c.ra},${c.dec}|${season.utc}`, () => fetchFieldAsteroids({ centre: c, seasons: [season], base: BASE })
      .then(r => Object.assign(r[0], { failed: !r[0].ok }))
      .catch(e => ({ ...season, ok: false, error: e.message, failed: true })), force);
  });
  return { t0: Math.min(...parts.map(e => e.t0)), p: Promise.all(parts.map(e => e.p)) };
}
function update(s) {
  const before = s.verdict?.kind;
  s.verdict = withColour(decideVerdict(s.check), s.colour); // colour only adds an evidence line (colour.js)
  if (s.id === S.sel && before && before !== 'pending' && s.verdict.kind !== 'pending' && s.verdict.kind !== before) toast(`Suspect ${s.n}: the verdict changed to ${s.verdict.title}.`);
  renderSide(); steps(); draw();
}
// running seconds for the JPL check, updated each second without re-drawing the panel
setInterval(() => {
  const s = selected(); if (!s?.astStart) return;
  const sec = `${Math.round((Date.now() - s.astStart) / 1000)} s`;
  for (const el of document.querySelectorAll('[data-secs]')) el.textContent = sec;
}, 1000);

/* ------------------------------------------------------------------ side panel: suspects, checklist, verdict, report */
const ICON = {
  pending: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 2.4"/></svg>',
  checking: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" class="sm-spin"><path d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  clear: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 8.2l2 2 4-4.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  explained: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2.5" fill="currentColor"/><path d="M8 4.6v4.2M8 10.9v.5" stroke="#FFF8F0" stroke-width="1.8" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor"/></svg>',
  failed: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 1.8l6.6 11.6H1.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6v3.4M8 11.2v.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};
function renderSide() {
  if (S.botha) { renderBotha(); return; }
  $('susCount').textContent = `${S.suspects.length} of ${MAX_SUSPECTS}`;
  $('susEmpty').hidden = !!S.suspects.length; $('sheetOpen').hidden = !S.suspects.length; $('clearAll').hidden = !S.suspects.length;
  const focusId = document.activeElement?.closest?.('#sus [data-id]')?.dataset.id; // re-render keeps keyboard focus
  $('sus').innerHTML = S.suspects.map(s => {
    const v = s.verdict && s.verdict.kind !== 'pending' ? s.verdict.title : 'checking…';
    return `<li class="${s.id === S.sel ? 'on' : ''}"><button class="sm-sbtn" type="button" data-id="${s.id}" aria-pressed="${s.id === S.sel}" aria-keyshortcuts="Delete" title="Suspect ${s.n} (Delete key removes it)"><span class="sm-num num">${s.n}</span><span class="sm-spos num x-only">${esc(formatRA(s.ra))}<br>${esc(formatDec(s.dec))}</span><span class="sm-sv">${esc(v)}</span></button><button class="key xbtn" type="button" data-rm="${s.id}" aria-label="Remove suspect ${s.n}" title="Remove suspect ${s.n}">✕</button></li>`;
  }).join('');
  for (const b of $('sus').querySelectorAll('[data-id]')) b.onclick = () => select(+b.dataset.id);
  for (const b of $('sus').querySelectorAll('[data-rm]')) b.onclick = (e) => removeSuspect(+b.dataset.rm, e.detail === 0); // detail 0 = keyboard press
  if (focusId) $('sus').querySelector(`[data-id="${focusId}"]`)?.focus();
  const s = selected();
  $('checkPanel').hidden = !s; $('report').hidden = !(s?.reportOpen && s.verdict && s.verdict.kind !== 'pending');
  $('sheetTitle').textContent = s ? `Suspect ${s.n}` : 'Suspects';
  if (!s) { $('verdict').hidden = true; return; }
  $('chkN').textContent = s.n;
  const open = new Set([...$('lines').querySelectorAll('details[open]')].map(d => d.dataset.id));
  const secs = () => `<span data-secs>${s.astStart ? Math.round((Date.now() - s.astStart) / 1000) : 0} s</span>`;
  $('lines').innerHTML = s.check.lines.map(l => {
    const word = l.status === 'checking' && l.id === 'asteroid' ? `Checking… · ${secs()}` : esc(STATE_WORD[l.status]);
    const result = l.text ? twin(esc(plainCheckText(l.id, s.lines[l.id] || l.data)), esc(l.text)) : l.status === 'checking' && l.id === 'asteroid' ? 'JPL can take a minute (at most 90 s).' : '';
    const ev = l.data ? evidence(l.id, l.data, s) : '';
    const retry = l.status === 'failed' ? `<button class="key sm-retry" type="button" data-retry="${l.id}">Retry</button>` : '';
    return `<li class="sm-l st-${l.status}"><details data-id="${l.id}"${open.has(l.id) ? ' open' : ''}><summary><span class="sm-ic">${ICON[l.status]}</span><span class="sm-lt"><b>${esc(checkTitle(l.id))}</b><span class="sm-word">${word}</span></span><span class="sm-lr">${result}</span></summary>${ev}</details>${retry}</li>`;
  }).join('');
  $('lines').insertAdjacentHTML('beforeend', colourItem(s, open.has('colour')));
  for (const b of $('lines').querySelectorAll('[data-retry]')) b.onclick = () => runChecks(s, b.dataset.retry);
  paintThumbs(s);
  renderVerdict(s);
}

function tagged(t, cls) { return `<span class="tag ${cls}">${t}</span>`; }
// The colour line (5th, after the four checks): an estimate, shown in the checklist, never a verdict.
function colourItem(s, isOpen) {
  const c = s.colour, st = c ? 'info' : s.check.lines.some(l => l.status === 'checking') ? 'checking' : 'pending';
  const word = c ? 'Estimate' : STATE_WORD[st];
  const blend = c?.blend ? ` A catalogued star, ${starLabel(c.blend)}, sits ${fmtArc(c.blend.ref)} from the dot, inside the ${fmtArc(AP_PX * PIXEL_ARCSEC)} measuring circle: the colour is a blend of both.` : '';
  const t = c ? colourLines(c, c.seasons.join(' + ')) : null;
  const result = c ? twin(esc(t.simple + (blend ? ' A nearby star shares the measuring circle, so this mixes both.' : '')), esc(t.expert + blend)) : '';
  return `<li class="sm-l st-${st}"><details data-id="colour"${isOpen ? ' open' : ''}><summary><span class="sm-ic">${ICON[st]}</span><span class="sm-lt"><b>${esc(COLOUR_LABEL)}</b><span class="sm-word">${esc(word)}</span></span><span class="sm-lr">${result}</span></summary>${c ? colourEvidence(c) : ''}</details></li>`;
}
function colourEvidence(c) {
  const rows = COLOUR_GROUPS.map(G => { const g = c.groups[G.id]; return `<tr><td>${esc(G.name)}<small>detector${G.dets.length > 1 ? 's' : ''} ${G.dets.length > 1 ? `${G.dets[0]}–${G.dets.at(-1)}` : G.dets[0]}</small></td><td class="r num">${g.used} of ${g.n}</td><td class="r num">${g.mean != null ? `${g.mean.toPrecision(3)} ± ${g.err.toPrecision(2)}` : '—'}</td></tr>`; }).join('');
  return `<p class="sm-evh">${tagged('OBSERVED', 'obs')} the dot's light in each image of the ${esc(c.seasons.join(' and '))} · lines ${tagged('COMPUTED', 'comp')}</p>
    <div class="s-only"><p class="sm-evn">SPHEREx sees each wavelength in a different image. Star Shift adds up the dot's light in the short-wavelength images (0.75–2.4 µm) and in the long ones (3.8–5.0 µm) and compares them: ordinary stars are brighter at short wavelengths, cold brown dwarfs much brighter at long ones, and asteroids reflect sunlight and add their own warmth. It is a hint only and never changes the verdict.</p></div>
    <div class="x-only"><table class="sm-tab"><thead><tr><th>Wavelengths</th><th class="r">Images used</th><th class="r">Mean Fν, mJy</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="sm-evn">Aperture photometry at the dot's centre: a ${AP_PX}-pixel (${fmtArc(AP_PX * PIXEL_ARCSEC)}) circle minus the median of a sky ring 4–8 pixels out, in each image of the season; an image with a blanked (saturated or bad) pixel in the circle is skipped. Error: the larger of the sky noise and the scatter left after a straight line in wavelength. ${esc(ratioText(c) || 'No ratio.')} Boundaries come from physics, evaluated at these very wavelengths (blackbodies at 2300 K, the coolest stars, and 600 K, the hottest asteroid surface), not fitted to any target. Supporting evidence only: the verdict is decided by the four checks above.</p></div>`;
}
function evidence(id, d, s) {
  if (id === 'flags') {
    return `<p class="sm-evh">${tagged('OBSERVED', 'obs')} Flags within one pixel of the ring, per image</p>
      <ul class="sm-evl">${d.per.map(p => `<li><b>${esc(p.label)}</b>: <span class="num">${p.flagged}</span> of <span class="num">${p.n}</span> images flagged${p.flagged ? ` (${ARTEFACT_KINDS.filter(k => p.kinds[k.id]).map(k => `${esc(k.name)} <span class="num">${p.kinds[k.id]}</span>`).join(', ')})` : ''}${p.saturated ? ` · pixel overflow from a bright star in <span class="num">${p.saturated}</span>` : ''}</li>`).join('')}</ul>
      <div class="sm-thumbs">${d.per.map((p, i) => `<figure><canvas class="sm-th" data-kind="flags" data-i="${i}" width="84" height="84"></canvas><figcaption>${esc(p.label)}</figcaption></figure>`).join('')}</div>
      <p class="sm-evn">Marks (7 × 7 pixels around the ring): × signal jump, three dots scattered light, square outline any other flag, in at least one image of that season. Flags come from the archive's own quality mask for each image.</p>`;
  }
  if (id === 'star') {
    const rows = (d.near || []).slice(0, 5);
    const src = [d.gaia && `Gaia DR3 ${d.gaia.ok ? `(${d.gaia.n} stars within 150″)` : 'did not answer'}`, d.simbad && `SIMBAD ${d.simbad.ok ? `(${d.simbad.n} entries within 300″)` : 'did not answer'}`].filter(Boolean).join(' · ');
    const simpleRows = rows.slice(0, 3).map(r => `<li>${/^Gaia DR3 \d+$/.test(r.name) ? 'A star in Gaia DR3' : `<b>${esc(r.name)}</b> (${esc(r.source)})`}: ${r.minSep <= STAR_MATCH_ARCSEC ? 'lands on your ring' : 'lands away from your ring'}${r.pm >= 1 ? ', moves fast' : ''}</li>`).join('');
    return `<p class="sm-evh">${tagged('CATALOGUE', 'cat')} nearest catalogue entries · predicted places ${tagged('COMPUTED', 'comp')}</p>
      <div class="s-only">${rows.length ? `<ul class="sm-evl">${simpleRows}</ul>` : '<p class="sm-evn">No catalogue entries near the ring.</p>'}
      <p class="sm-evn">Checked against Gaia DR3 and SIMBAD. Each star is moved along its known motion to each season's date; it explains the ring when it lands within about one and a half pixels of it. If more than one does, the one closest to the dot you clicked is named.${d.mover ? ' On the image, a dashed ivory ring marks where the catalogue puts it in the season shown.' : ''}</p></div>
      <div class="x-only">${rows.length ? `<table class="sm-tab"><thead><tr><th>Entry</th><th class="r">Motion</th><th>First season</th><th>Latest season</th></tr></thead><tbody>
      ${rows.map(r => `<tr${r === d.best ? ' class="on"' : ''}><td>${esc(r.name)}<small>${esc(r.source)}</small></td><td class="r num">${r.pm ? r.pm.toFixed(r.pm < 1 ? 3 : 2) + '″/yr' : '<span title="no motion in this catalogue entry">—</span>'}</td><td class="num">${esc(offsetText({ ra: s.ra, dec: s.dec }, r.pos[0]))}</td><td class="num">${esc(offsetText({ ra: s.ra, dec: s.dec }, r.pos[1]))}</td></tr>`).join('')}</tbody></table>` : '<p class="sm-evn">No catalogue entries near the ring.</p>'}
      <p class="sm-evn">${esc(src)}. Each entry is moved in a straight line with its catalogued proper motion to the middle of each season (no parallax wobble). It explains the ring when it lands within 9.2″ (1.5 pixels) of it or of the dot you clicked; of those, the entry nearest ${d.dot?.part ? 'the top of the glow your ring sits on (no dot of its own under it)' : d.dot ? `the measured centre of the dot you clicked (${esc(d.dot.k ? 'latest' : 'first')} season, <span class="num">${d.dot.snr.toFixed(0)}</span>× the noise)` : 'your ring (no dot under it to measure)'} is named, a moving entry only when it is within ${STAR_TIE_ARCSEC}″ of the nearest.${d.mover ? ' On the image, a dashed ivory ring marks where the catalogue puts it in the season shown.' : ''}</p></div>`;
  }
  if (id === 'asteroid') {
    const res = d.results || [], ring = { ra: s.ra, dec: s.dec };
    const nearest = (rows) => rows.map(o => ({ o, d: passDistance(o, ring) })).sort((a, b) => a.d - b.d).slice(0, 3);
    const simple = res.map(r => {
      const close = r.ok ? nearest(r.rows).filter(x => x.d <= ASTEROID_MATCH_ARCSEC) : [];
      return `<li><b>${esc(r.label)}</b>: ${!r.ok ? 'JPL did not answer'
        : !r.rows.length ? 'no known objects in the patch'
          : `${r.rows.length} known object${r.rows.length === 1 ? '' : 's'} in the patch; ${close.length ? `${close.map(({ o }) => esc(simpleBodyName(o.name))).join(', ')} pass${close.length === 1 ? 'es' : ''} your ring` : 'none passes your ring'}`}</li>`;
    }).join('');
    return `<p class="sm-evh">${tagged('JPL', 'cat')} Small-Body Identification for the whole patch<span class="x-only">&nbsp;(a ${(ASTEROID_HALF_WIDTH_DEG * 7200).toFixed(0)}″ box), distances from your ring</span></p>
      <div class="s-only"><ul class="sm-evl">${simple}</ul>
      <p class="sm-evn">JPL's orbit list predicts where every known asteroid and comet was at the time of each season's middle image. An object explains the ring only if its path crosses it and it is bright enough for SPHEREx to see. These are predictions, not detections.</p></div>
      <div class="x-only"><ul class="sm-evl">${res.map(r => `<li><b>${esc(r.label)}</b>, image at <span class="num">${esc(String(r.utc).slice(0, 16).replace('T', ' '))}</span> UTC: ${r.ok
        ? (r.rows.length ? `${r.rows.length} known object${r.rows.length === 1 ? '' : 's'} in the patch; nearest to your ring ${nearest(r.rows).map(({ o, d }) => `${esc(o.name)} <span class="num">${Number.isFinite(d) ? fmtArc(d) : '—'}</span>${o.vmag != null ? ` (V <span class="num">${o.vmag}</span>)` : ''}`).join(', ')}` : 'no known objects in the patch')
        + (r.observer ? ` <small>(observer given as ${r.observer === 'mpc-500' ? 'MPC code 500' : 'a geocentric state vector'})</small>` : '')
        : `no answer${r.status ? ` (HTTP <span class="num">${r.status}</span>)` : r.error ? ` (${esc(r.error)})` : ''}`}</li>`).join('')}</ul>
      <p class="sm-evn">Observer: the Earth's centre (SPHEREx is 700 km up; that shifts a main-belt asteroid by under 2″). Asked once per patch and season; an object explains the ring only when its predicted path (within an hour of the image) passes within 12″ (2 pixels) AND it is bright enough for SPHEREx to see (V ≤ 18.5, an approximate limit). These are JPL's predictions, not detections.</p></div>`;
  }
  if (id === 'seasons') {
    return `<p class="sm-evh">${tagged('OBSERVED', 'obs')} Each season's stacked picture at the ring (9 × 9 pixels)</p>
      <div class="sm-thumbs">${d.per.map((p, i) => `<figure><canvas class="sm-th" data-kind="season" data-i="${i}" width="84" height="84"></canvas><figcaption>${esc(p.label)}<br>${p.found ? `<span class="s-only">clear dot</span><span class="x-only">dot, <span class="num">${p.found.snr.toFixed(0)}</span>× the noise</span>` : 'no clear dot'}</figcaption></figure>`).join('')}</div>
      <p class="sm-evn"><span class="s-only">A dot counts when it clearly stands out from the background, close to the ring</span><span class="x-only">A dot counts when its peak is at least 5 times the noise, within 2 pixels of the ring</span>${s.lines.star?.mover ? ' or of the known star\'s predicted place' : ''}.</p>`;
  }
  return '';
}

// Crop of a stack around the suspect, with the viewer's stretch (and flag marks for the flags check).
function paintThumbs(s) {
  const vs = viewSettings(), n = S.grid.n;
  for (const cv of $('lines').querySelectorAll('canvas.sm-th')) {
    const flags = cv.dataset.kind === 'flags', i = +cv.dataset.i;
    const st = flags ? blinked()[i] : S.stacks[i], half = flags ? 3 : 4, side = 2 * half + 1, cell = cv.width / side;
    const off = document.createElement('canvas');
    R.draw(off, st.F, n, { ramp: vs.ramp, cell: 8, ring: false, stretch: vs.str, maskBg: '#211b16', maskInk: '#6b5d50' });
    const c = cv.getContext('2d'), cx = Math.round(s.x), cy = Math.round(s.y);
    c.fillStyle = '#15110E'; c.fillRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = false;
    c.drawImage(off, (cx - half) * 8, (cy - half) * 8, side * 8, side * 8, 0, 0, cv.width, cv.height);
    const rx = (s.x - cx + half + .5) * cell, ry = (s.y - cy + half + .5) * cell;
    c.strokeStyle = '#E3A86B'; c.lineWidth = 1.5; c.beginPath(); c.arc(rx, ry, 1.6 * cell, 0, Math.PI * 2); c.stroke();
    if (!flags) continue;
    // marks (DESIGN.md 23 shapes, ivory with a dark under-stroke): × cosmic · dots scatter · square other
    for (let j = cy - half; j <= cy + half; j++) for (let ii = cx - half; ii <= cx + half; ii++) {
      if (ii < 0 || j < 0 || ii >= n || j >= n) continue;
      const kinds = new Set(); for (const f of st.frames) for (const k of flagsAtSpot(f, ii, j, 0).kinds) kinds.add(k);
      if (!kinds.size) continue;
      const x0 = (ii - cx + half) * cell, y0 = (j - cy + half) * cell, m = cell / 3;
      for (const [w, col] of [[3, 'rgba(11,9,7,.8)'], [1.25, 'rgba(255,246,232,.85)']]) {
        c.lineWidth = w; c.strokeStyle = col; c.fillStyle = col; c.beginPath();
        if (kinds.has('cosmic')) { c.moveTo(x0 + 2, y0 + 2); c.lineTo(x0 + 2 + m, y0 + 2 + m); c.moveTo(x0 + 2 + m, y0 + 2); c.lineTo(x0 + 2, y0 + 2 + m); c.stroke(); }
        else if (kinds.has('scatter')) { for (const t of [.2, .35, .5]) { c.moveTo(x0 + t * cell + 1, y0 + t * cell); c.arc(x0 + t * cell, y0 + t * cell, w === 3 ? 1.8 : 1, 0, Math.PI * 2); } c.fill(); }
        else { c.strokeRect(x0 + 1.5, y0 + 1.5, cell - 3, cell - 3); }
      }
    }
  }
}

// Extra 4, "Report this find" (report.js): every season as an epoch, with the dot's measured place in it
// (the seasons check), its images and their IRSA cutout links. Built fresh each time the verdict re-renders.
function reportFor(s) {
  const per = s.lines.seasons?.per || [];
  const epochs = S.stacks.map((st, i) => {
    const f = per[i]?.found;
    return { label: st.label, mjd: st.mjd, frames: st.frames, found: f ? (([ra, dec]) => ({ ra, dec }))(gridToWorld(S.grid, f.x, f.y)) : null };
  });
  return buildReport({ field: { key: S.field.key, label: S.field.label, query: S.field.query, centre: { ra: S.grid.ra0, dec: S.grid.dec0 } },
    suspect: s, epochs, lines: s.check.lines, verdict: s.verdict, pageHref: location.href,
    colour: s.colour ? { text: s.colour.text, ratio: ratioText(s.colour) ? `${ratioText(s.colour)}, Fν 3.8–5.0 µm over 0.75–2.4 µm` : '' } : null });
}
function fillReport(s) {
  const r = s.report = reportFor(s);
  $('repPractice').hidden = !r.practice;
  $('repPractice').innerHTML = `<b>Practice report.</b> Star Shift explained this suspect (${esc(r.verdict.title)}), so there is nothing to report. The keys below show what a real report holds.`;
  $('repCaveat').textContent = CAVEAT;
  $('repLinks').innerHTML = HOW_TO.map(l => `<li><a href="${l.href}" target="_blank" rel="noopener">${esc(l.name)}</a> ${esc(l.forWhat)}. ${esc(l.steps)}</li>`).join('');
  $('sum').textContent = reportMarkdown(r);
  $('repShare').href = r.shareLink;
}
async function copyText(txt, btn, label, what) {
  let ok = false;
  try { await navigator.clipboard.writeText(txt); ok = true; } catch {
    try { // older or locked-down browsers
      const ta = Object.assign(document.createElement('textarea'), { value: txt }); ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
    } catch { ok = false; }
  }
  if (!ok) { toast('Copy was blocked by the browser. Use "Download JSON", or switch on Expert to select the full report.'); return; }
  btn.textContent = 'Copied'; toast(`${what} copied. Star Shift has not sent it anywhere.`);
  setTimeout(() => { btn.textContent = label; }, 1600);
}
function notebookEntry(s) {
  const v = s.verdict, [A, B] = blinked();
  const checks = s.check.lines.map(l => `${checkTitle(l.id)}: ${STATE_WORD[l.status]}`).join('; ');
  return {
    label: `Spot a mover · suspect ${s.n} · ${S.field.label}`,
    value: `${v.title}${v.sub ? ` (${v.sub})` : ''}. Ring at ${fmtPos(s)} (J2000). Seasons ${seasonRange(A)} and ${seasonRange(B)}. Checks: ${checks}.${s.colour ? ` ${COLOUR_LABEL}: ${s.colour.text}.` : ''}`,
    unit: '', uncertainty: '', source: 'NASA SPHEREx via IRSA (DOIs 10.26131/IRSA678, 10.26131/IRSA662); Gaia DR3; SIMBAD; JPL Small-Body Identification',
    tag: 'COMPUTED',
    context: { page: 'Spot', ra: +s.ra.toFixed(6), dec: +s.dec.toFixed(6), date: `${fmtDay(A.mjd)} / ${fmtDay(B.mjd)}`, frameId: `${middleImage(A).obsid} / ${middleImage(B).obsid}`, url: location.href },
  };
}
// Spec A: signal-to-noise of the suspect's dot on the middle image of the season it was found in (snr-ui.js).
// Measured once per suspect; the card re-renders every second, so it shows the cached line.
function snrCard(s) {
  if (S.botha) return '';
  if (s.snr === undefined) {
    s.snr = null;
    const k = s.dot ? s.dot.k : (S.show ? 1 : 0), st = blinked()[k], img = st && middleImage(st);
    const ra = s.dot ? s.dot.ra : s.ra, dec = s.dot ? s.dot.dec : s.dec;
    if (img?.uri) spotSnrMeasure(st, img, S.frames, ra, dec, { base: BASE, label: `${k ? 'latest' : 'first'} season, ${fmtDay(img.mjd)}`, grid: S.grid, key: S.field?.key, name: S.field?.label })
      .then(m => { s.snr = m || ''; }, () => { s.snr = '<p class="snr-line muted">Signal-to-noise: this image\'s pixels could not be loaded.</p>'; })
      .then(() => { if (S.sel === s.id && $('smSnr')) $('smSnr').innerHTML = snrNow(s); });
  }
  return snrNow(s) || '<p class="snr-line muted">Measuring the signal-to-noise…</p>';
}
// drawn with the verdict of the moment, so an artefact / nothing verdict never sits under "clearly real" (Judging panel round 9)
function snrNow(s) {
  return s.snr && typeof s.snr === 'object' ? spotSnrRender(s.snr, s.verdict) : s.snr;
}
function renderVerdict(s) {
  const v = s.verdict, el = $('verdict');
  const waitingJpl = v?.kind === 'pending' && v.running?.length === 1 && v.running[0] === 'asteroid';
  el.hidden = !(v && (v.kind !== 'pending' || waitingJpl));
  announceVerdict(waitingJpl ? `Suspect ${s.n}: waiting for the asteroid check.` : v && v.kind !== 'pending' ? `Suspect ${s.n} verdict: ${v.title}${v.sub ? ` ${v.sub}` : ''}.` : '');
  if (waitingJpl) {
    el.className = 'glass sm-verdict v-wait';
    el.innerHTML = `<p class="sm-vk">Verdict for suspect <span class="num">${s.n}</span></p><h2>Waiting for the asteroid check</h2>
      <p class="sm-vb">The other three checks found nothing that explains this. "Unexplained" needs JPL's asteroid check too.</p>
      <p class="sm-vrun">Asteroid check still running · <span data-secs>${Math.round((Date.now() - (s.astStart || Date.now())) / 1000)} s</span></p>`;
    return;
  }
  if (!v || v.kind === 'pending') { el.innerHTML = ''; return; }
  const retry = v.retry ? v.retry.map(id => `<button class="key" type="button" data-vretry="${id}">Retry "${esc(checkTitle(id))}"</button>`).join('') : '';
  el.className = `glass sm-verdict v-${v.kind}`;
  el.innerHTML = `<p class="sm-vk">Verdict for suspect <span class="num">${s.n}</span></p>
    <h2>${esc(v.title)}${v.sub ? ` <span class="sm-vsub">${esc(v.sub)}</span>` : ''}</h2>
    <p class="sm-vb">${v.body.map(esc).join(' ')}</p>
    ${v.evidence?.length ? `<ul class="sm-vev">${v.evidence.map((t, i) => `<li>${i === 0 && (v.decidedBy === 'star' || v.decidedBy === 'asteroid') ? twin(esc(plainCheckText(v.decidedBy, s.lines[v.decidedBy])), esc(t)) : esc(t)}</li>`).join('')}</ul>` : ''}
    ${v.running?.includes('asteroid') ? `<p class="sm-vrun">Asteroid check still running · <span data-secs>${Math.round((Date.now() - (s.astStart || Date.now())) / 1000)} s</span>${v.kind === 'artefact' ? '. A known asteroid here would change this answer' : ''}.</p>` : ''}
    ${v.notRun ? `<p class="sm-evn">${esc(v.notRun)}</p>` : ''}
    <div class="sm-snr" id="smSnr">${snrCard(s)}</div>
    ${retry ? `<div class="sm-vkeys">${retry}</div>` : ''}
    <div class="sm-record"><p><b>Record it.</b> Save this suspect's position, the two seasons, the four checks and the verdict to your lab notebook (kept on this device).</p>
      <div class="sm-vkeys"><button class="key primary" type="button" id="saveNb">Save to notebook</button><button class="key" type="button" id="openNb">Open notebook</button></div></div>
    <div class="sm-record"><p>${v.kind === 'unexplained' ? '<b>Report it?</b> Prepare a report (positions, dates, images, checks and a link back here) to paste or download. You decide where it goes; Star Shift never sends it.'
      : '<b>Practice a report.</b> The checks explained this one, so there is nothing to report, but you can see what a report holds.'}</p>
      <div class="sm-vkeys"><button class="key${v.kind === 'unexplained' ? ' primary' : ''}" type="button" id="prepRep" aria-controls="report" aria-expanded="${!!s.reportOpen}">Prepare a report</button></div></div>`;
  for (const b of el.querySelectorAll('[data-vretry]')) b.onclick = () => runChecks(s, b.dataset.vretry);
  $('saveNb').onclick = () => {
    try { notebookAdd(notebookEntry(s)); s.saved = true; $('saveNb').textContent = 'Saved to notebook'; toast(`Suspect ${s.n} saved to your notebook.`); }
    catch (e) { toast('The notebook could not save this (browser storage blocked?).'); }
  };
  if (s.saved) $('saveNb').textContent = 'Saved to notebook';
  $('openNb').onclick = () => openNotebook();
  $('prepRep').onclick = () => {
    s.reportOpen = true; fillReport(s); renderSide();
    const rep = $('report'); rep.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'start' });
    $('repH').focus({ preventScroll: true });
  };
  if (s.reportOpen) fillReport(s);
}
const report = () => selected()?.report;
$('repByw').onclick = () => { const r = report(); if (r) copyText(bywText(r), $('repByw'), 'Copy for Backyard Worlds', 'The Backyard Worlds text is'); };
$('repMpc').onclick = () => { const r = report(); if (r) copyText(mpcNotes(r), $('repMpc'), 'Copy in MPC-style notes', 'The MPC-style notes are'); };
$('repJson').onclick = () => {
  const r = report(); if (!r) return;
  try {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })), download: reportFileName(r) });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`Downloading ${reportFileName(r)}. Nothing was sent anywhere.`);
  } catch { toast('The download was blocked by the browser.'); }
};
$('copy').onclick = () => copyText($('sum').textContent, $('copy'), 'Copy', 'The full report is');

/* ------------------------------------------------------------------ stepper */
function steps() {
  const s = selected(), v = s?.verdict;
  const cur = !S.ready ? 1 : !S.suspects.length ? 2 : (v && v.kind !== 'pending') || (s && s.check.lines.some(l => l.status !== 'pending')) ? 4 : 3;
  const done = { 1: S.ready ? S.field.label : '', 2: S.ready ? `${fmtDay(S.stacks[0].startDate).replace(/^\d+ /, '')} ↔ ${fmtDay(S.stacks[lastIdx()].endDate).replace(/^\d+ /, '')}` : '',
    3: S.suspects.length ? `${S.suspects.length} suspect${S.suspects.length === 1 ? '' : 's'}` : '', 4: v && v.kind !== 'pending' ? v.title : '' };
  for (const b of document.querySelectorAll('.sm-step')) {
    const k = +b.dataset.step;
    b.classList.toggle('cur', k === cur); b.classList.toggle('done', !!done[k] && k !== cur);
    if (k === cur) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    $('st' + k).textContent = done[k];
  }
  $('stepPhone').textContent = `Step ${cur} of 4 · ${['Pick a field', 'Blink', 'Click a suspect', 'Verify'][cur - 1]}`;
}
for (const b of document.querySelectorAll('.sm-step')) b.onclick = () => {
  const k = +b.dataset.step;
  if (k === 1) { foldPick(false); $('pick').scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'center' }); $('pick').querySelector('button')?.focus({ preventScroll: true }); }
  else if (k === 4) { openSheet(); $('side').scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'nearest' }); }
  else $('stage').scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'center' });
};

/* ------------------------------------------------------------------ phone sheet */
const phone = () => matchMedia('(max-width:700px)').matches;
function openSheet() { if (!phone()) return; $('side').classList.add('open'); $('scrim').hidden = false; }
function closeSheet() { $('side').classList.remove('open'); $('scrim').hidden = true; }
$('sheetClose').onclick = closeSheet; $('sheetOpen').onclick = () => { if (phone()) openSheet(); }; $('scrim').onclick = closeSheet;

/* ------------------------------------------------------------------ "Known asteroid" example: one night (botha.js) */
// Season pictures median out an asteroid, so this example blinks the first and last exposure of one
// SPHEREx visit (detector 3, 1.9-2.0 µm) with JPL's predicted place ringed; the card replaces the checklist.
const BOTHA_FIELD = { key: BOTHA_KEY, label: 'Asteroid 1354 Botha, one night', target: null };
const HINT = $('hint').textContent;
function bothaMode(on) {
  S.botha = on ? S.botha : null;
  $('sus').closest('section').hidden = on; $('checkPanel').hidden = on || !selected();
  if (!on) $('hint').textContent = HINT;
  $('sheetOpen').textContent = on ? 'Details' : 'Checks'; if (on) $('sheetOpen').hidden = false; // phone: the card sits in the bottom sheet
}
async function loadBotha() {
  S.ctl?.abort(); const ctl = S.ctl = new AbortController();
  stopBlink(); clearSuspects();
  Object.assign(S, { field: BOTHA_FIELD, target: null, grid: null, frames: [], stacks: [], seasonFrames: [], allSeasons: [], band: null, ready: false, loaded: 0, planned: 0, failed: 0, show: 0 });
  $('fBand').hidden = true; markPicks(); foldPick(true);
  $('fName').textContent = BOTHA_FIELD.label; $('fCoords').textContent = '';
  showState('Opening one night of SPHEREx images', 'Saved with the app, so this works offline.'); steps();
  let j;
  try { j = await fetch(BOTHA_URL, { signal: ctl.signal }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }); }
  catch (e) { if (!ctl.signal.aborted) showState('This example could not open', `Its saved file did not load (${e.message}).`, [['Retry', () => loadBotha()]]); return; }
  if (ctl.signal.aborted) return;
  const frames = bothaFrames(j), d3 = frames.filter(f => f.detector === 3);
  S.botha = { j, frames, colour: bothaColour(frames), card: bothaCard(j) };
  S.grid = bothaGrid(j);
  $('fCoords').textContent = `Field centre: ${formatRA(S.grid.ra0)} ${formatDec(S.grid.dec0)}`;
  updateNav({ type: 'coords', ra: S.grid.ra0, dec: S.grid.dec0 });
  S.stacks = d3.map((f, i) => ({ n: f.n, data: f.data, F: { d: Array.from(f.data, v => (Number.isFinite(v) ? v : null)) }, count: 1, mjd: f.mjd,
    startDate: new Date(f.date + 'Z'), endDate: new Date(f.date + 'Z'), label: `Image ${i + 1} of ${d3.length}`, frames: [f], predicted: f.predicted, utc: f.date, wl: f.wavelengthUm }));
  S.ready = true; progress(); showState(null); bothaMode(true);
  const a = S.stacks[0], z = S.stacks[S.stacks.length - 1], mins = Math.round((z.mjd - a.mjd) * 1440);
  $('hint').textContent = `The dashed ring is where JPL predicts asteroid 1354 Botha in the image shown. JPL's predicted place moves ${fmtArc(Math.hypot(z.predicted.x - a.predicted.x, z.predicted.y - a.predicted.y) * PIXEL_ARCSEC)} between the first and last image, ${mins} minutes apart.`;
  S.show = 0; startBlink(); layout(); steps(); renderBotha();
}
function renderBotha() {
  const B = S.botha; if (!B) return;
  const card = B.card, c = B.colour, t = colourLines(c, 'night of 14 Dec 2025'), el = $('verdict');
  el.hidden = false; el.className = 'glass sm-verdict v-known-asteroid'; $('sheetTitle').textContent = 'Example';
  el.innerHTML = `<p class="sm-vk">Example</p>
    <h2>${esc(card.title)} <span class="sm-vsub">${esc(card.sub)}</span></h2>
    <p class="sm-vb">${card.body.map(esc).join(' ')}</p>
    <ul class="sm-vev">${card.evidence.map(x => `<li>${esc(x)}</li>`).join('')}<li>${twin(esc(t.simple), esc(t.expert))}</li></ul>
    <p class="sm-evn x-only">${esc(B.j.sources.predicted)}. Images: ${esc(B.j.frames.map(f => f.image).join(', '))}. Pixels: ${esc(B.j.sources.mask)}. The colour uses both detectors (3 and 6) at the predicted place in each image.</p>
    <div class="sm-vkeys"><a class="key" href="neo.html">Open Asteroids</a></div>`;
  announceVerdict('Example: known asteroid 1354 Botha, as JPL predicts.');
}

/* ------------------------------------------------------------------ shell: Clarity, Pages, search */
initClarity();
const toggler = (popId, btnId) => (e) => { e.stopPropagation(); const p = $(popId); p.hidden || !p.classList.contains('open') ? showPop(p, $(btnId)) : closePop(); };
$('clarityBtn').onclick = toggler('clarity', 'clarityBtn');
$('pagesBtn').onclick = toggler('pagesPop', 'pagesBtn');
document.addEventListener('click', (e) => { for (const id of ['clarity', 'pagesPop']) { const p = $(id); if (!p.hidden && !p.contains(e.target) && !e.target.closest('#clarityBtn, #pagesBtn')) closePop(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('clarity').hidden || !$('pagesPop').hidden) closePop(true); else closeSheet(); } });
new MutationObserver(() => { if (S.ready) { if (S.blinking) startBlink(); draw(); } }).observe(root, { attributes: true, attributeFilter: ['data-motion'] });

async function searchField(text, push = true) {
  const err = $('serr'); err.hidden = true;
  let q; try { q = parseQuery(text); } catch (e) { err.textContent = e.message; err.hidden = false; return; }
  let t; try { t = await resolve(q); } catch (e) { err.textContent = e.message; err.hidden = false; return; }
  const quick = QUICK.find(f => t.presetKey && f.key === t.presetKey);
  if (quick) { choose(quick, push); return; }
  if (push) history.pushState(null, '', '?' + (q.type === 'name' ? 'q=' + encodeURIComponent(q.name) : `ra=${q.ra.toFixed(5)}&dec=${q.dec.toFixed(5)}`));
  loadField({ key: 'q', label: t.name || `Typed position ${formatRA(t.ra)} ${formatDec(t.dec)}`, target: t, query: q });
}
$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); S.pendingClick = null; searchField($('q').value); });

// A click from the address (logic.js parseClick): placed once the field's seasons are stacked.
function placeClick() {
  const c = S.pendingClick; S.pendingClick = null;
  if (!c || !S.ready) return;
  const [gx, gy] = worldToGrid(S.grid, c.ra, c.dec), n = S.grid.n;
  if (!(gx >= -0.5 && gx <= n - 0.5 && gy >= -0.5 && gy <= n - 0.5)) { toast('That example spot is outside this field.'); return; }
  S.show = c.season; draw();
  addSuspect(+gx.toFixed(2), +gy.toFixed(2));
}
function fromURL() {
  const p = new URLSearchParams(location.search);
  S.pendingClick = parseClick(p);
  if (p.get('field') === BOTHA_KEY) return loadBotha();
  const f = fieldByKey(p.get('field') || '');
  if (f) return loadField(f);
  if (p.get('q')) { $('q').value = p.get('q'); return searchField(p.get('q'), false); }
  if (p.has('ra') && p.has('dec')) { $('q').value = `${p.get('ra')} ${p.get('dec')}`; return searchField(`${p.get('ra')} ${p.get('dec')}`, false); }
  S.ctl?.abort(); S.field = null; S.ready = false; bothaMode(false); clearSuspects(); stopBlink(); markPicks(); steps();
}
window.addEventListener('popstate', fromURL);
buildPicker(); renderSide(); steps(); fromURL();
