// First-visit guided tour (DESIGN.md section 33): the offer card, the Help entry and the
// step cards with a copper outline around the part each one explains.
// It reads the app only through the DOM and the read-only window.__app hook; it never edits ui.js state.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { STEPS, INTRO, WAITING, OUTRO, PHONE_MAX, filterSteps, counterText, neighbour,
  shouldOffer, remember, reducedMotion, placeCard, unionRect } from './steps.js';

const $ = id => document.getElementById(id);
const isPhone = () => innerWidth <= PHONE_MAX;
const getStore = () => { try { return window.localStorage; } catch { return null; } };
const reduce = () => {
  let raw = null; try { raw = window.localStorage.getItem('tgi-clarity-v1'); } catch { /* private mode */ }
  return reducedMotion({ clarityRaw: raw, datasetMotion: document.documentElement.dataset.motion, osReduce: matchMedia('(prefers-reduced-motion: reduce)').matches });
};
const FADE = 180, PAD = 6;
const wait = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- visibility of a step's target ---------- */
function shown(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) return false;
  for (let p = el; p && p !== document.body; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none') return false;
  return true;
}
const elsOf = step => (step.targets || []).flatMap(sel => [...document.querySelectorAll(sel)]);
function targetRect(step) {
  const r = unionRect(elsOf(step).filter(shown).map(e => e.getBoundingClientRect()));
  return r && { left: r.left - PAD, top: r.top - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD };
}
const inViewer = () => $('app')?.dataset.scene === 'viewer';
function available(step) {
  if (step.scene === 'viewer' && !inViewer()) return elsOf(step).length > 0; // checked for real once the time-lapse is open
  return !!targetRect(step);
}
const steps = () => filterSteps(STEPS, { hasNotebook: typeof window.openNotebook === 'function', isAvailable: available });

/* ---------- the time-lapse: open Barnard's Star (or the pick already selected) ---------- */
const app = () => window.__app;
function viewerReady() {
  const V = app()?.V;
  return inViewer() && $('stLoading')?.hidden !== false && (!V || V.F?.length > 0 || V.status !== 'loading');
}
async function until(test, ms, run) { const t0 = performance.now(); while (!test()) { if (run.dead || performance.now() - t0 > ms) return test(); await wait(150); } return true; }
async function openViewer(run) {
  if (viewerReady()) return true;
  if (!inViewer()) {
    if ($('stMap') && !$('stMap').hidden) $('mapOpenFilm')?.click(); // map failed: its own "Open time-lapse" key
    else {
      if (!app()?.M?.sel?.t?.preset) {
        const pick = [...document.querySelectorAll('.pick')].find(b => /barnard/i.test(b.textContent)) || document.querySelector('.pick');
        pick?.click();
        await until(() => !!app()?.M?.sel?.t?.preset, 6000, run);
        if (run.dead) return false;
      }
      $('mdPlay')?.click();
    }
  }
  return until(viewerReady, 25000, run);
}

/* ---------- DOM ---------- */
let layer, hole, blocks, card, live, offer;
function build() {
  if (layer) return;
  layer = document.createElement('div'); layer.className = 'tour-layer'; layer.hidden = true;
  layer.innerHTML = '<div class="tour-hole"></div>' + '<div class="tour-block"></div>'.repeat(4);
  hole = layer.querySelector('.tour-hole'); blocks = [...layer.querySelectorAll('.tour-block')];
  card = document.createElement('div'); card.className = 'tour-card glass'; card.hidden = true;
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'false');
  card.setAttribute('aria-labelledby', 'tourTitle'); card.setAttribute('aria-describedby', 'tourBody');
  card.innerHTML = `<div class="tour-count num" id="tourCount"></div><h2 id="tourTitle"></h2><p id="tourBody"></p>
    <div class="tour-actions"><button class="tour-skip" type="button" id="tourSkip">Skip</button><span class="tour-grow"></span>
    <button class="key" type="button" id="tourBack">Back</button><button class="key primary" type="button" id="tourNext">Next</button></div>
    <span class="sr-only" aria-live="polite" id="tourLive"></span>`;
  document.body.append(layer, card);
  live = card.querySelector('#tourLive');
  card.querySelector('#tourSkip').onclick = () => end();
  card.querySelector('#tourBack').onclick = () => go(-1);
  card.querySelector('#tourNext').onclick = () => go(1);
}

/* ---------- running tour ---------- */
let run = null; // { cur, list, returnTo, raf, last, dead }

// positions follow the target every frame (layout shifts, phone scrolling); render/resize/scroll also call it directly
function loop() { if (!run || run.dead) return; update(); run.raf = requestAnimationFrame(loop); }
function update() {
  if (!run || run.dead) return;
  const step = run.cur, r = step.targets ? targetRect(step) : null;
  const phone = isPhone(), vw = innerWidth, vh = innerHeight;
  const key = r ? `${r.left|0},${r.top|0},${r.width|0},${r.height|0},${vw},${vh}` : `none,${vw},${vh},${run.mode}`;
  if (key !== run.last) {
    run.last = key;
    if (r) {
      hole.style.transform = `translate(${r.left}px,${r.top}px)`; hole.style.width = r.width + 'px'; hole.style.height = r.height + 'px';
      hole.classList.remove('none');
      // blockers around the hole: the highlighted part stays usable, the dimmed rest does not take clicks
      const R = r.left + r.width, B = r.top + r.height;
      const set = (b, x, y, w, h) => { b.style.cssText = `left:${x}px;top:${y}px;width:${Math.max(0, w)}px;height:${Math.max(0, h)}px`; };
      set(blocks[0], 0, 0, vw, r.top); set(blocks[1], 0, B, vw, vh - B); set(blocks[2], 0, r.top, r.left, r.height); set(blocks[3], R, r.top, vw - R, r.height);
    } else {
      hole.classList.add('none'); hole.style.width = hole.style.height = '0px';
      hole.style.transform = `translate(${vw / 2}px,${vh / 2}px)`;
      const open = run.mode === 'waiting'; // while loading, the loader's own keys stay usable
      blocks.forEach((b, i) => { b.style.cssText = i || open ? 'width:0;height:0' : `left:0;top:0;width:${vw}px;height:${vh}px`; });
    }
    card.classList.toggle('sheet', phone);
    if (phone) { card.style.left = card.style.top = ''; }
    else {
      const c = { w: card.offsetWidth, h: card.offsetHeight };
      const st = $('stage')?.getBoundingClientRect();
      let p;
      if (r) p = placeCard(r, c, { w: vw, h: vh }, step.prefer);
      else if (st && st.width) p = { left: Math.round(st.left + (st.width - c.w) / 2), top: Math.round(st.top + (st.height - c.h) / 2) };
      else p = { left: Math.round((vw - c.w) / 2), top: Math.round((vh - c.h) / 2) };
      card.style.left = p.left + 'px'; card.style.top = p.top + 'px';
    }
  }
}

// phone: the highlighted part scrolls into view above the bottom sheet
function scrollAboveSheet(step) {
  if (!isPhone() || !step.targets) return;
  const r = targetRect(step); if (!r) return;
  const sheetH = card.offsetHeight + 16, room = innerHeight - sheetH;
  document.documentElement.style.setProperty('--tour-sheet-h', sheetH + 'px');
  const want = Math.max(8, (room - r.height) / 2);
  if (r.top < 8 || r.top + r.height > room) scrollBy({ top: r.top - want, behavior: reduce() ? 'auto' : 'smooth' });
}

function render(step, mode) {
  run.cur = step; run.mode = mode; run.last = null;
  const list = run.list, i = list.findIndex(s => s.id === step.id);
  card.querySelector('#tourCount').textContent = mode === 'step' ? counterText(i, list.length) : '';
  card.querySelector('#tourCount').hidden = mode !== 'step';
  card.querySelector('#tourTitle').textContent = step.title;
  card.querySelector('#tourBody').textContent = step.body;
  const back = card.querySelector('#tourBack'), next = card.querySelector('#tourNext'), skip = card.querySelector('#tourSkip');
  back.hidden = mode === 'intro' || mode === 'waiting' || (mode === 'step' && !neighbour(STEPS, list, step.id, -1));
  next.hidden = mode === 'waiting';
  next.textContent = step.next || 'Next';
  skip.hidden = mode === 'outro';
  layer.classList.toggle('waiting', mode === 'waiting');
  live.textContent = `${mode === 'step' ? counterText(i, list.length) + '. ' : ''}${step.title}. ${step.body}`;
  // fade + 8 px rise (180 ms, ease-out); instant with Reduce motion
  hole.classList.toggle('moving', !reduce());
  clearTimeout(run.moveT); run.moveT = setTimeout(() => hole.classList.remove('moving'), 260);
  card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
  update(); scrollAboveSheet(step); update();
  (next.hidden ? skip : next).focus({ preventScroll: true });
}

async function show(step, dir) {
  const token = run.token = (run.token || 0) + 1;
  if (step.scene === 'viewer' && !viewerReady()) {
    const slow = setTimeout(() => { if (run && run.token === token) render(WAITING, 'waiting'); }, 300);
    await openViewer(run);
    clearTimeout(slow);
    if (!run || run.dead || run.token !== token) return;
  }
  run.list = steps();
  if (!run.list.some(s => s.id === step.id)) { // missing or hidden here (e.g. phone layout): skip it quietly
    const nxt = neighbour(STEPS, run.list, step.id, dir || 1);
    if (nxt) return show(nxt, dir || 1);
    return dir < 0 ? render(INTRO, 'intro') : render(OUTRO, 'outro');
  }
  render(step, 'step');
}

function go(dir) {
  if (!run) return;
  const cur = run.cur;
  if (cur.id === 'outro' && dir > 0) return end();
  if (cur.id === 'waiting') return;
  run.list = steps();
  const nxt = neighbour(STEPS, run.list, cur.id, dir);
  if (nxt) return show(nxt, dir);
  if (dir > 0) return render(OUTRO, 'outro');
  if (cur.id !== 'intro') render(INTRO, 'intro');
}

function onKey(e) { if (run && e.key === 'Escape') { end(); } }
function onMove() { update(); }

export function start(returnTo) {
  build(); hideOffer(true);
  if (run) return;
  remember(getStore(), 'started');
  run = { returnTo: returnTo || document.activeElement, list: steps(), dead: false };
  document.documentElement.dataset.tour = 'on';
  layer.hidden = false; card.hidden = false;
  void layer.offsetWidth; layer.classList.add('on'); // reflow first so the 180 ms fade still runs
  addEventListener('keydown', onKey, true);
  addEventListener('resize', onMove); addEventListener('scroll', onMove, { passive: true, capture: true });
  render(INTRO, 'intro');
  run.raf = requestAnimationFrame(loop);
}

export function end() {
  if (!run) return;
  const r = run; r.dead = true; run = null;
  cancelAnimationFrame(r.raf); clearTimeout(r.moveT);
  removeEventListener('keydown', onKey, true);
  removeEventListener('resize', onMove); removeEventListener('scroll', onMove, { capture: true });
  remember(getStore(), 'done');
  layer.classList.remove('on'); card.classList.remove('in');
  const ms = reduce() ? 0 : FADE;
  setTimeout(() => {
    if (run) return; // restarted meanwhile
    layer.hidden = true; card.hidden = true; delete document.documentElement.dataset.tour;
    document.documentElement.style.removeProperty('--tour-sheet-h');
  }, ms);
  // focus goes back where it was (after ui.js's own Esc handler has run)
  setTimeout(() => { const t = r.returnTo; (t && t.isConnected && shown(t) ? t : $('helpBtn'))?.focus?.({ preventScroll: true }); }, 0);
}

/* ---------- the first-visit offer ---------- */
function placeOffer() {
  if (!offer || offer.hidden) return;
  if (isPhone()) { offer.style.cssText = ''; offer.classList.add('sheet'); return; }
  offer.classList.remove('sheet');
  const st = $('stage')?.getBoundingClientRect(); if (!st) return;
  offer.style.right = Math.max(12, innerWidth - st.right + 16) + 'px';
  offer.style.bottom = Math.max(12, innerHeight - st.bottom + 56) + 'px';
}
function hideOffer(instant) {
  if (!offer || offer.hidden) return;
  offer.classList.remove('in'); removeEventListener('resize', placeOffer);
  setTimeout(() => { offer.hidden = true; }, instant || reduce() ? 0 : FADE);
}
function showOffer() {
  if (run || !shouldOffer(getStore())) return;
  offer = document.createElement('section'); offer.className = 'tour-offer glass'; offer.setAttribute('aria-labelledby', 'tourOfferT');
  offer.innerHTML = `<p class="tour-offer-t" id="tourOfferT">${esc('New here? Take a 2-minute tour')}</p>
    <div class="tour-actions"><button class="key" type="button" id="tourLater">Not now</button><button class="key primary" type="button" id="tourGo">Start tour</button></div>`;
  document.body.append(offer);
  offer.querySelector('#tourGo').onclick = () => start($('helpBtn'));
  offer.querySelector('#tourLater').onclick = () => { remember(getStore(), 'dismissed'); hideOffer(); };
  placeOffer(); addEventListener('resize', placeOffer);
  void offer.offsetWidth; offer.classList.add('in');
}

/* ---------- wiring ---------- */
function init() {
  build();
  const btn = $('tourStart');
  if (btn) btn.addEventListener('click', e => {
    e.stopPropagation();
    if ($('help') && !$('help').hidden) $('helpBtn')?.click(); // ui.js toggles its own popover closed
    start($('helpBtn'));
  });
  // offer once the app has settled: map ready (or failed), no loader on screen
  const t0 = performance.now();
  (async () => {
    await until(() => (app()?.skymap?.aladin || ($('stMap') && !$('stMap').hidden) || performance.now() - t0 > 5000) && $('stLoading')?.hidden !== false, 30000, {});
    await wait(700);
    showOffer();
  })();
}
window.StarShiftTour = { start: () => start(document.activeElement), end }; // for the console and future hooks
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
