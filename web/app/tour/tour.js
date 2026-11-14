// First-visit guided tour (DESIGN.md section 33): the offer card, the Help entry and the
// step cards with a copper outline around the part each one explains.
// It reads the app only through the DOM and the read-only window.__app hook; it never edits ui.js state.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { STEPS, INTRO, WAITING, OUTRO, PHONE_MAX, filterSteps, counterText, neighbour,
  shouldOffer, remember, reducedMotion, placeCard, unionRect, pickVariant, bodyFor } from './steps.js';

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
const els = targets => (targets || []).flatMap(sel => [...document.querySelectorAll(sel)]);
const selShown = sel => els([sel]).some(shown), selExists = sel => !!document.querySelector(sel);
const variant = step => pickVariant(step, selShown, selExists); // own targets, or the phone alternative, or null
function targetRect(step) {
  const v = variant(step); if (!v || !v.targets) return null;
  const r = unionRect(els(v.targets).filter(shown).map(e => e.getBoundingClientRect()));
  return r && keepClear({ left: r.left - PAD, top: r.top - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD }, r, step.avoid);
}
// The padded outline never runs into a neighbouring control listed in step.avoid (e.g. the Speed keys
// right under the View keys): the padding on that side is trimmed to leave a 4 px gap (2 px ring + 2).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
function keepClear(p, raw, avoid) {
  if (!avoid) return p;
  let L = p.left, T = p.top, R = p.left + p.width, B = p.top + p.height;
  const rawR = raw.left + raw.width, rawB = raw.top + raw.height, G = 4;
  for (const a of els(avoid).filter(shown).map(e => e.getBoundingClientRect())) {
    if (a.right <= L || a.left >= R || a.bottom <= T || a.top >= B) continue; // no overlap
    if (a.top >= rawB) B = Math.min(B, Math.max(rawB, a.top - G));
    else if (a.bottom <= raw.top) T = Math.max(T, Math.min(raw.top, a.bottom + G));
    else if (a.left >= rawR) R = Math.min(R, Math.max(rawR, a.left - G));
    else if (a.right <= raw.left) L = Math.max(L, Math.min(raw.left, a.right + G));
  }
  return { left: L, top: T, width: R - L, height: B - T };
}
const inViewer = () => $('app')?.dataset.scene === 'viewer';
function available(step) {
  if (step.scene === 'viewer' && !inViewer()) return els(step.targets).length > 0; // checked for real once the time-lapse is open
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
    run.opened = true; // the tour opened the time-lapse: step 2 says so, and leaving step 2 pauses it
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
  // phone: once per step, as soon as its part can be measured, scroll it above the bottom sheet
  if (r && phone && run.scrolledFor !== step.id) { run.scrolledFor = step.id; card.classList.add('sheet'); scrollAboveSheet(step); return update(); }
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
      if (r) p = placeCard(r, c, { w: vw, h: vh }, variant(step)?.prefer || step.prefer);
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
  if (r.top >= 8 && r.top + r.height <= room) return;
  const y0 = scrollY, dy = r.top - want;
  if (reduce() || document.hidden) return scrollBy({ top: dy });
  scrollBy({ top: dy, behavior: 'smooth' });
  setTimeout(() => { if (Math.abs(scrollY - y0) < 1) scrollTo({ top: y0 + dy }); }, 450); // smooth scroll stalls when the page isn't painting
}

function render(step, mode) {
  run.cur = step; run.mode = mode; run.last = null; run.scrolledFor = null;
  const list = run.list, [i, n] = mode === 'step' ? planPos(step.id) : [-1, 0];
  card.querySelector('#tourCount').textContent = mode === 'step' ? counterText(i, n) : '';
  card.querySelector('#tourCount').hidden = mode !== 'step';
  card.querySelector('#tourTitle').textContent = step.title;
  const body = bodyFor(step, (step.targets && variant(step)?.body) || step.body, { openedName: run.opened ? (app()?.V?.name || "Barnard's Star") : null });
  card.querySelector('#tourBody').textContent = body;
  const back = card.querySelector('#tourBack'), next = card.querySelector('#tourNext'), skip = card.querySelector('#tourSkip');
  back.hidden = mode === 'intro' || mode === 'waiting' || (mode === 'step' && !neighbour(STEPS, list, step.id, -1));
  next.hidden = mode === 'waiting';
  next.textContent = step.next || 'Next';
  skip.hidden = mode === 'outro';
  layer.classList.toggle('waiting', mode === 'waiting');
  live.textContent = `${mode === 'step' ? counterText(i, n) + '. ' : ''}${step.title}. ${body}`;
  // fade + 8 px rise (180 ms, ease-out); instant with Reduce motion
  hole.classList.toggle('moving', !reduce());
  clearTimeout(run.moveT); run.moveT = setTimeout(() => hole.classList.remove('moving'), 260);
  card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
  update();
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
    dropFromPlan(step.id);
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
  if (cur.id === 'play') leavePlay();
  run.list = steps();
  const nxt = neighbour(STEPS, run.list, cur.id, dir);
  dropSkipped(cur.id, nxt ? nxt.id : dir > 0 ? 'outro' : 'intro');
  if (nxt) return show(nxt, dir);
  if (dir > 0) return render(OUTRO, 'outro');
  if (cur.id !== 'intro') render(INTRO, 'intro');
}

// The counter ("2 of 7") counts a plan made once at the start, so the total never jumps while the tour
// runs. It only shrinks when a planned step really has to be skipped; a step shown is never removed.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
const order = id => STEPS.findIndex(s => s.id === id);
function planPos(id) {
  run.seen.add(id);
  if (!run.plan.includes(id)) run.plan = STEPS.map(s => s.id).filter(x => x === id || run.plan.includes(x));
  return [run.plan.indexOf(id), run.plan.length];
}
function dropFromPlan(id) { if (!run.seen.has(id)) run.plan = run.plan.filter(x => x !== id); }
function dropSkipped(fromId, toId) {
  const pos = id => id === 'intro' ? -1 : id === 'outro' ? STEPS.length : order(id);
  const lo = Math.min(pos(fromId), pos(toId)), hi = Math.max(pos(fromId), pos(toId));
  for (const id of [...run.plan]) if (pos(id) > lo && pos(id) < hi) dropFromPlan(id);
}

// leaving step 2: pause the time-lapse the tour opened (once), with the app's own pause key, so later
// steps (flags) don't flicker. Its autoplay can start a moment after loading, so watch for it briefly.
function leavePlay() {
  if (!run?.opened || run.paused) return;
  const r = run; r.paused = true;
  const tryPause = () => { const k = $('play'); if (k?.dataset.playing === 'true') { k.click(); return true; } return false; };
  if (tryPause()) return;
  let n = 0; const iv = setInterval(() => { if (r.dead || r.cur?.id === 'play' || tryPause() || ++n > 25) clearInterval(iv); }, 200);
}

function onKey(e) { if (run && e.key === 'Escape') { end(); } }
function onMove() { update(); }

export function start(returnTo) {
  build(); hideOffer(true);
  if (run) return;
  remember(getStore(), 'started');
  run = { returnTo: returnTo || document.activeElement, list: steps(), dead: false };
  run.plan = run.list.map(s => s.id); run.seen = new Set();
  document.documentElement.dataset.tour = 'on';
  layer.hidden = false; card.hidden = false;
  void layer.offsetWidth; layer.classList.add('on'); // reflow first so the 180 ms fade still runs
  addEventListener('keydown', onKey, true);
  addEventListener('resize', onMove); addEventListener('scroll', onMove, { passive: true, capture: true });
  render(INTRO, 'intro');
  run.raf = requestAnimationFrame(loop);
  run.iv = setInterval(update, 250); // rAF stops in background tabs; this keeps the outline honest there too
}

export function end() {
  if (!run) return;
  const r = run; r.dead = true; run = null;
  cancelAnimationFrame(r.raf); clearTimeout(r.moveT); clearInterval(r.iv);
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
  setTimeout(() => {
    const ok = el => el && el !== document.body && el.isConnected && shown(el);
    [r.returnTo, $('helpBtn'), $('pagesBtn')].find(ok)?.focus?.({ preventScroll: true });
  }, 0);
}

/* ---------- the first-visit offer ---------- */
function placeOffer() {
  if (!offer || offer.hidden) return;
  if (isPhone()) { // one 56 px strip just under the top bar, clear of the dock's Play key
    const tb = $('topbar')?.getBoundingClientRect();
    offer.classList.add('strip'); offer.style.cssText = `top:${Math.round((tb ? tb.bottom : 0) + scrollY + 8)}px`;
    return;
  }
  offer.classList.remove('strip'); offer.style.cssText = '';
  const st = $('stage')?.getBoundingClientRect(); if (!st) return;
  const ip = $('insp'), ir = ip && shown(ip) ? ip.getBoundingClientRect() : null; // the info panel overlaps the stage's right edge
  const edge = ir && ir.left > st.left && ir.left < st.right ? ir.left : st.right;
  offer.style.right = Math.max(12, innerWidth - edge + 16) + 'px';
  offer.style.bottom = Math.max(12, innerHeight - st.bottom + 72) + 'px'; // clear of the map's credit strip
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
    <div class="tour-actions"><button class="key tour-later" type="button" id="tourLater">Not now</button><button class="key primary" type="button" id="tourGo"><span class="o-lg">Start tour</span><span class="o-sm">Tour</span></button><button class="key icon tour-x" type="button" id="tourX" aria-label="Not now">✕</button></div>`;
  document.body.append(offer);
  offer.querySelector('#tourGo').onclick = () => start($('helpBtn'));
  const later = () => { remember(getStore(), 'dismissed'); hideOffer(); };
  offer.querySelector('#tourLater').onclick = later; offer.querySelector('#tourX').onclick = later;
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
