// Guided tour engine: runs one page's chapter, or the full tour across pages (progress kept in
// localStorage so it resumes on the next page). Copper outline round the real control, dimmed rest,
// a glass card that never covers the control (bottom sheet on phones, the control scrolled above it).
// Reads the app only through the DOM and the read-only window.__app hook.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { CHAPTERS, chapterById, nextChapter, chapterRunsHere, pickTargets, counterFor, placeClear,
  readProgress, writeProgress, clearProgress, pageOf } from './chapters.js';
import { INTRO, WAITING, PHONE_MAX, reducedMotion, unionRect, remember } from './steps.js';
import { markTutorial } from './progress.js';

const $ = id => document.getElementById(id);
const isPhone = () => innerWidth <= PHONE_MAX;
export const getStore = () => { try { return window.localStorage; } catch { return null; } };
const reduce = () => {
  let raw = null; try { raw = window.localStorage.getItem('tgi-clarity-v1'); } catch { /* private mode */ }
  return reducedMotion({ clarityRaw: raw, datasetMotion: document.documentElement.dataset.motion, osReduce: matchMedia('(prefers-reduced-motion: reduce)').matches });
};
const FADE = 180, PAD = 6;
const wait = ms => new Promise(r => setTimeout(r, ms));
const page = () => pageOf(location.pathname);
const scene = () => $('app')?.dataset.scene || 'map';
const nbDialog = () => document.querySelector('dialog.notebook-dialog[open]');

const FINAL = { id: 'final', title: "That's the tour",
  body: 'Tour this page, at the top of every page, replays the part for that page. Under Pages it also offers the full tour again.' };

/* ---------- what a step points at ---------- */
function shown(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) return false;
  for (let p = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none') return false;
  // under a modal dialog the rest of the page cannot be used: only parts inside it count
  const dlg = nbDialog(); if (dlg && !dlg.contains(el)) return false;
  return true;
}
const els = sels => (sels || []).flatMap(sel => { try { return [...document.querySelectorAll(sel)]; } catch { return []; } });
const selShown = sel => els([sel]).some(shown), selExists = sel => els([sel]).length > 0;
const variant = step => pickTargets(step, { phone: isPhone(), shown: selShown, exists: selExists });
function rawRect(step) {
  const v = variant(step); if (!v || !v.targets) return null;
  // one element per selector (the first shown), so a list selector never outlines the whole page
  return unionRect(v.targets.map(s => els([s]).find(shown)).filter(Boolean).map(e => e.getBoundingClientRect()));
}
function targetRect(step) {
  const r = rawRect(step); if (!r) return null;
  return keepClear({ left: r.left - PAD, top: r.top - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD }, r, step.avoid);
}
// the padded outline never runs into a neighbouring control listed in step.avoid (4 px gap)
function keepClear(p, raw, avoid) {
  if (!avoid) return p;
  let L = p.left, T = p.top, R = p.left + p.width, B = p.top + p.height;
  const rawR = raw.left + raw.width, rawB = raw.top + raw.height, G = 4;
  for (const a of els(avoid).filter(shown).map(e => e.getBoundingClientRect())) {
    if (a.right <= L || a.left >= R || a.bottom <= T || a.top >= B) continue;
    if (a.top >= rawB) B = Math.min(B, Math.max(rawB, a.top - G));
    else if (a.bottom <= raw.top) T = Math.max(T, Math.min(raw.top, a.bottom + G));
    else if (a.left >= rawR) R = Math.min(R, Math.max(rawR, a.left - G));
    else if (a.right <= raw.left) L = Math.max(L, Math.min(raw.left, a.right + G));
  }
  return { left: L, top: T, width: R - L, height: B - T };
}

/* ---------- opening what a step needs (the only clicks the tour makes) ---------- */
const app = () => window.__app;
async function until(test, ms, r) { const t0 = performance.now(); while (!test()) { if (r?.dead || performance.now() - t0 > ms) return test(); await wait(150); } return true; }
function viewerReady() {
  const V = app()?.V;
  return scene() === 'viewer' && $('stLoading')?.hidden !== false && (!V || V.F?.length > 0 || V.status !== 'loading');
}
async function openViewer(r) {
  if (viewerReady()) return true;
  if (scene() !== 'viewer') {
    r.opened = true; // the tour opened the time-lapse: its first card says so, and leaving it pauses it
    if ($('stMap') && !$('stMap').hidden) $('mapOpenFilm')?.click(); // map failed: its own "Open time-lapse" key
    else {
      // the quick tour is about Barnard's Star, whatever was picked before
      const notBarnard = r.mode === 'quick' && !/barnard/i.test(app()?.M?.sel?.t?.name || '');
      if (!app()?.M?.sel?.t?.preset || notBarnard) {
        const pick = [...document.querySelectorAll('.pick')].find(b => /barnard/i.test(b.textContent)) || document.querySelector('.pick');
        pick?.click();
        await until(() => !!app()?.M?.sel?.t?.preset && (!notBarnard || /barnard/i.test(app()?.M?.sel?.t?.name || '')), 6000, r);
        if (r.dead) return false;
      }
      ($('mdPlay') || $('cdPlay'))?.click();
    }
  }
  return until(viewerReady, 25000, r);
}
async function openMap(r) {
  if (scene() !== 'viewer') return true;
  $('mapBack')?.click();
  return until(() => scene() !== 'viewer', 4000, r);
}
async function openPart(what, r) {
  if (what === 'neo-orbits' || what === 'neo-spotter') {
    const tab = $(what === 'neo-orbits' ? 'orbits-tab' : 'spotter-tab');
    if (tab && tab.getAttribute('aria-selected') !== 'true') { tab.click(); await wait(250); }
  } else if (what === 'notebook' && !nbDialog()) {
    try { (await import('../notebook/notebook.js')).openNotebook(); r.openedNotebook = true; } catch { /* step is skipped */ }
    await wait(60);
  } else if (what === 'proof-barnard') markBarnard(await until(() => !!barnardRow(), 8000, r));
}
// Proof page: Barnard's Star's first row (the motion test). The mark stays after the tour ends.
const barnardRow = () => [...document.querySelectorAll('tr.pf-row')].find(tr => /barnard/i.test(tr.querySelector('.pf-obj b')?.textContent || ''));
function markBarnard(ok) {
  const tr = ok && barnardRow(); if (!tr) return;
  document.querySelectorAll('tr.pf-row[data-tour-mark]').forEach(x => { if (x !== tr) { delete x.dataset.tourMark; x.classList.remove('tour-mark'); } });
  tr.dataset.tourMark = '1'; tr.classList.add('tour-mark');
}
// leaving the first viewer step: pause the time-lapse the tour opened, with the app's own key
function pauseOpened(r) {
  if (!r?.opened || r.paused) return;
  r.paused = true;
  const tryPause = () => { const k = $('play'); if (k?.dataset.playing === 'true') { k.click(); return true; } return false; };
  if (tryPause()) return;
  let n = 0; const iv = setInterval(() => { if (r.dead || tryPause() || ++n > 25) clearInterval(iv); }, 200);
}

/* ---------- DOM ---------- */
let layer, hole, blocks, card, live;
function build() {
  if (layer) return;
  layer = document.createElement('div'); layer.className = 'tour-layer'; layer.hidden = true;
  layer.innerHTML = '<div class="tour-hole"></div>' + '<div class="tour-block"></div>'.repeat(4);
  hole = layer.querySelector('.tour-hole'); blocks = [...layer.querySelectorAll('.tour-block')];
  card = document.createElement('div'); card.className = 'tour-card glass'; card.hidden = true;
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'false');
  card.setAttribute('aria-labelledby', 'tourTitle'); card.setAttribute('aria-describedby', 'tourBody');
  card.innerHTML = `<div class="tour-count num" id="tourCount"></div><h2 id="tourTitle"></h2><div class="tour-body" id="tourBody"></div>
    <div class="tour-actions"><button class="tour-skip" type="button" id="tourSkip">Skip</button><span class="tour-grow"></span>
    <button class="key" type="button" id="tourBack">Back</button><button class="key" type="button" id="tourAlt" hidden></button><button class="key primary" type="button" id="tourNext">Next</button></div>
    <span class="sr-only" aria-live="polite" id="tourLive"></span>`;
  document.body.append(layer, card);
  live = card.querySelector('#tourLive');
  card.querySelector('#tourSkip').onclick = () => end('skip');
  card.querySelector('#tourBack').onclick = () => go(-1);
  // a click meant for the card before (e.g. the loading card turning into step 2) must not skip the new card (full test G1)
  card.querySelector('#tourNext').onclick = () => { if (performance.now() - (run?.paintedAt || 0) > 400) go(1); };
  card.querySelector('#tourAlt').onclick = () => run?.altAction?.();
}
// a modal dialog (the Lab notebook) makes the rest of the page inert: the tour moves inside it while it is open
function rehome() {
  const host = nbDialog() || document.body;
  if (layer.parentNode !== host) host.append(layer, card);
}

/* ---------- running tour ---------- */
let run = null; // { mode, ch, plan, idx, cur, kind, token, dead, ... }
export const running = () => !!run;

function loop() { if (!run || run.dead) return; update(); run.raf = requestAnimationFrame(loop); }
function update() {
  if (!run || run.dead) return;
  rehome();
  const step = run.cur, r = run.kind === 'step' && step.targets ? targetRect(step) : null;
  const phone = isPhone(), vw = innerWidth, vh = innerHeight;
  if (r && run.scrolledFor !== step.id) { run.scrolledFor = step.id; card.classList.toggle('sheet', phone); scrollIntoRoom(step); return update(); }
  const key = r ? `${r.left|0},${r.top|0},${r.width|0},${r.height|0},${vw},${vh},${card.offsetHeight}` : `none,${vw},${vh},${run.kind},${card.offsetHeight}`;
  if (key === run.last) return;
  run.last = key;
  if (r) {
    hole.style.transform = `translate(${r.left}px,${r.top}px)`; hole.style.width = r.width + 'px'; hole.style.height = r.height + 'px';
    hole.classList.remove('none');
    // blockers round the hole: the highlighted part stays usable, the dimmed rest does not take clicks
    const R = r.left + r.width, B = r.top + r.height;
    const set = (b, x, y, w, h) => { b.style.cssText = `left:${x}px;top:${y}px;width:${Math.max(0, w)}px;height:${Math.max(0, h)}px`; };
    set(blocks[0], 0, 0, vw, r.top); set(blocks[1], 0, B, vw, vh - B); set(blocks[2], 0, r.top, r.left, r.height); set(blocks[3], R, r.top, vw - R, r.height);
  } else {
    hole.classList.add('none'); hole.style.width = hole.style.height = '0px';
    hole.style.transform = `translate(${vw / 2}px,${vh / 2}px)`;
    const open = run.kind === 'waiting'; // while loading, the loader's own keys stay usable
    blocks.forEach((b, i) => { b.style.cssText = i || open ? 'width:0;height:0' : `left:0;top:0;width:${vw}px;height:${vh}px`; });
  }
  card.classList.toggle('sheet', phone);
  if (phone) { // bottom sheet; at the top instead when the part sits at the very bottom and cannot scroll up (notebook footer)
    card.style.left = card.style.top = '';
    card.classList.toggle('top', !!r && r.top + r.height > vh - card.offsetHeight - 16 && r.top > card.offsetHeight + 16);
    return;
  }
  card.classList.remove('top');
  const c = { w: card.offsetWidth, h: card.offsetHeight };
  let p;
  if (r) p = placeClear(r, c, { w: vw, h: vh }, variant(step)?.prefer || step.prefer || []);
  else {
    const st = run.kind === 'waiting' ? $('stage')?.getBoundingClientRect() : null; // the loader sits on the stage
    p = st && st.width ? { left: Math.round(st.left + (st.width - c.w) / 2), top: Math.round(st.top + (st.height - c.h) / 2) }
      : { left: Math.round((vw - c.w) / 2), top: Math.round((vh - c.h) / 2) };
  }
  card.style.left = p.left + 'px'; card.style.top = p.top + 'px';
}

// once per step: bring the part into view (phones: above the bottom sheet), instantly
function scrollIntoRoom(step) {
  const v = variant(step); if (!v?.targets) return;
  const el = v.targets.map(s => els([s]).find(shown)).find(Boolean); if (!el) return;
  const r = rawRect(step); if (!r) return;
  const phone = isPhone();
  const sheetH = phone ? card.offsetHeight + 16 : 0;
  if (phone) document.documentElement.style.setProperty('--tour-sheet-h', sheetH + 'px');
  const room = innerHeight - sheetH;
  if (r.top >= 8 && r.top + r.height <= room - 8) return; // already in view
  const want = Math.max(8, (room - r.height) / 2);
  // nested scrollers (notebook content, panels) first, then the page itself
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) {
      const pr = p.getBoundingClientRect(), er = el.getBoundingClientRect();
      const top0 = Math.max(pr.top, 0), bot0 = Math.min(pr.bottom, room); // the part of the scroller the user can see
      p.scrollTop += er.top - (top0 + Math.max(0, (bot0 - top0 - er.height) / 2));
      break;
    }
  }
  const r2 = rawRect(step); if (!r2 || nbDialog()?.contains(el)) return; // the page behind a modal dialog does not need to move
  if (r2.top < 8 || r2.top + r2.height > room - 8) scrollBy({ top: r2.top - want, behavior: 'instant' });
}

function setButtons({ back, next, alt, altText, skip = true }) {
  const b = card.querySelector('#tourBack'), n = card.querySelector('#tourNext'), a = card.querySelector('#tourAlt'), s = card.querySelector('#tourSkip');
  b.hidden = !back; n.hidden = !next; n.textContent = next || 'Next';
  a.hidden = !alt; a.textContent = altText || ''; run.altAction = alt || null;
  s.hidden = !skip;
}
function paint(title, body, list, counter) {
  const cnt = card.querySelector('#tourCount');
  cnt.textContent = counter || ''; cnt.hidden = !counter;
  card.querySelector('#tourTitle').textContent = title;
  const bodyEl = card.querySelector('#tourBody');
  bodyEl.replaceChildren(...(body ? [Object.assign(document.createElement('p'), { textContent: body })] : []));
  if (list && !body) bodyEl.classList.add('lines'); else bodyEl.classList.remove('lines');
  if (list) {
    const ul = document.createElement('ul'); ul.className = 'tour-list';
    for (const [k, v] of list) { const li = document.createElement('li'); const b = document.createElement('b'); b.textContent = k; li.append(b, ' ', v); ul.append(li); }
    bodyEl.append(ul);
  }
  live.textContent = `${counter ? counter + '. ' : ''}${title}. ${body}${list ? ' ' + list.map(([k, v]) => `${k.replace(/:$/, '')}: ${v}`).join(' ') : ''}`;
  hole.classList.toggle('moving', !reduce());
  clearTimeout(run.moveT); run.moveT = setTimeout(() => hole.classList.remove('moving'), 260);
  card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
  run.paintedAt = performance.now();
  run.last = null; run.scrolledFor = null;
  update();
  const n = card.querySelector('#tourNext');
  (n.hidden ? card.querySelector('#tourSkip') : n).focus({ preventScroll: true });
}

function renderStep() {
  const step = run.cur = run.plan[run.idx]; run.kind = 'step';
  const v = variant(step), last = run.idx === run.plan.length - 1, nxt = nextChapter(run.ch.id);
  let body = v?.body || step.body;
  if (step.id === 'play' && run.opened) body = `We've opened ${app()?.V?.name || "Barnard's Star"} for you. ${body}`.trim();
  const full = run.mode === 'full', quick = run.mode === 'quick';
  // the last card of a chapter: Done, or on to the next page (the full and quick tours carry on by themselves)
  let next = 'Next', alt = null, altText = '';
  if (last && quick) next = nxt ? 'Next' : 'Finish';
  else if (last && full) next = nxt ? `Next: ${nxt.name}` : 'Finish';
  else if (last) { next = 'Finish'; if (nxt) { alt = () => continueFull(nxt); altText = `On to ${nxt.name}`; } }
  setButtons({ back: run.idx > 0, next, alt, altText });
  paint(v?.title || step.title, body, v?.lines || step.lines || step.list, counterFor(run.ch, run.idx, run.plan.length, full));
  save('running');
}
function renderCard(c, kind, buttons) {
  run.cur = c; run.kind = kind;
  setButtons(buttons);
  paint(c.title, c.body, null, '');
}

function save(status, extra = {}) {
  if (!run || run.ch?.id == null) return;
  writeProgress(getStore(), { mode: run.mode, chapter: run.ch.id, step: run.cur?.id || null, status, ...extra });
}

// a step can show only when its part is on screen (or, for steps that open something first, in the page)
const planned = step => !!variant(step) || (!!step.open && step.targets.some(selExists)) || step.open === 'notebook' || step.open === 'proof-barnard';

async function showStep(idx, dir) {
  const token = run.token = (run.token || 0) + 1;
  const step = run.plan[idx];
  if (!step) return dir < 0 ? (run.plan.length ? showStep(0, 1) : chapterDone()) : chapterDone();
  if (run.cur?.id === 'play' && step.id !== 'play') pauseOpened(run);
  if (step.open) await openPart(step.open, run);
  if (!run || run.dead || run.token !== token) return;
  if (!variant(step)) { // missing or hidden here (e.g. phone layout): skip it quietly, the counter shrinks
    run.plan.splice(idx, 1);
    return showStep(dir < 0 ? idx - 1 : idx, dir || 1);
  }
  run.idx = idx;
  renderStep();
}

function go(dir) {
  if (!run) return;
  if (run.kind === 'intro') return enterChapter(run.ch, null);
  if (run.kind === 'final') return end('done');
  if (run.kind !== 'step') return;
  if (dir > 0 && run.idx === run.plan.length - 1) return chapterDone();
  showStep(run.idx + dir, dir);
}

async function chapterDone() {
  const r = run, nxt = nextChapter(r.ch.id);
  markTutorial(getStore(), r.ch.id, 'done'); // seen to the end in any tour: it no longer starts by itself
  if (r.mode === 'quick') return nxt ? continueFull(nxt, 'quick') : end('done'); // ends on Proof, Barnard's row still marked
  if (r.mode !== 'full') return end('done');
  if (!nxt) { renderCard(FINAL, 'final', { next: 'Done', skip: false }); return; }
  return continueFull(nxt);
}
// on to the next chapter in full-tour mode: same page → straight on; else load its page and resume there
function continueFull(ch, mode = 'full') {
  if (!run) return;
  run.mode = mode;
  if (chapterRunsHere(ch, page())) return enterChapter(ch, null);
  writeProgress(getStore(), { mode, chapter: ch.id, step: null, status: 'running', nav: true });
  if (run.openedNotebook) nbDialog()?.close();
  location.href = ch.url;
}

async function enterChapter(ch, stepId) {
  const r = run; r.ch = ch; r.plan = []; r.idx = 0; r.stepWanted = stepId;
  if (ch.id !== 'notebook' && r.openedNotebook) { nbDialog()?.close(); r.openedNotebook = false; }
  const token = r.token = (r.token || 0) + 1;
  if (ch.needs === 'viewer' && !viewerReady()) {
    const slow = setTimeout(() => { if (run === r && r.token === token) renderCard(WAITING, 'waiting', { skip: true }); }, 300);
    await openViewer(r);
    clearTimeout(slow);
  } else if (ch.scene === 'map') await openMap(r);
  if (run !== r || r.dead || r.token !== token) return;
  return beginChapter();
}
function beginChapter() {
  const r = run, ch = r.ch;
  r.plan = ch.steps.filter(planned);
  if (!r.plan.length) return chapterDone();
  let i = r.stepWanted ? r.plan.findIndex(s => s.id === r.stepWanted) : 0;
  r.stepWanted = null;
  showStep(Math.max(0, i), 1);
}

function onKey(e) { if (run && e.key === 'Escape') end('skip'); }
function onMove() { update(); }

/**
 * Start a chapter (mode 'page') or the full tour (mode 'full', from chapterId or the first chapter).
 * If the chapter belongs to another page, that page is loaded and the tour resumes there.
 */
export function start({ mode = 'page', chapter, step = null, intro = false, returnTo, auto = false } = {}) {
  const ch = chapterById(chapter) || CHAPTERS[0];
  if (!chapterRunsHere(ch, page())) {
    writeProgress(getStore(), { mode, chapter: ch.id, step, status: 'running', nav: true, intro });
    location.href = ch.url; return;
  }
  build();
  if (run) teardown();
  remember(getStore(), 'started');
  run = { mode, auto, dead: false, returnTo: returnTo || document.activeElement };
  document.documentElement.dataset.tour = 'on';
  rehome();
  layer.hidden = false; card.hidden = false;
  void layer.offsetWidth; layer.classList.add('on');
  addEventListener('keydown', onKey, true);
  addEventListener('resize', onMove); addEventListener('scroll', onMove, { passive: true, capture: true });
  run.raf = requestAnimationFrame(loop);
  run.iv = setInterval(update, 250); // rAF stops in background tabs; this keeps the outline honest there too
  dispatchEvent(new CustomEvent('star-shift-tour-start', { detail: { auto, mode, chapter: ch.id } }));
  if (intro) { run.ch = ch; renderCard(INTRO, 'intro', { next: 'Start' }); return; }
  enterChapter(ch, step);
}

function teardown() {
  const r = run; if (!r) return null;
  r.dead = true; run = null;
  cancelAnimationFrame(r.raf); clearTimeout(r.moveT); clearInterval(r.iv);
  removeEventListener('keydown', onKey, true);
  removeEventListener('resize', onMove); removeEventListener('scroll', onMove, { capture: true });
  return r;
}

/** End the tour. 'skip' keeps the place so "Resume tour" can pick it up; 'done' forgets it. */
export function end(how = 'skip') {
  if (!run) return;
  const r = run;
  // first-visit tutorials: a page chapter that ends, finished or skipped, never starts by itself again
  if (r.mode === 'page' && r.ch?.id) markTutorial(getStore(), r.ch.id, how === 'done' ? 'done' : 'skipped');
  else if (how === 'skip' && r.ch?.id) markTutorial(getStore(), r.ch.id, 'skipped'); // a Skip in any tour: chips stay small
  if (how === 'skip' && r.kind === 'step' && !(r.mode === 'page' && r.idx === 0)) {
    writeProgress(getStore(), { mode: r.mode, chapter: r.ch.id, step: r.cur?.id || null, status: 'paused' });
  } else if (how === 'skip' && (r.kind === 'waiting' || r.kind === 'intro') && r.mode !== 'page') {
    writeProgress(getStore(), { mode: r.mode, chapter: r.ch.id, step: null, status: 'paused' });
  } else clearProgress(getStore());
  teardown();
  remember(getStore(), 'done');
  if (r.openedNotebook) nbDialog()?.close();
  if (r.cur?.id === 'play') pauseOpened(r);
  layer.classList.remove('on'); card.classList.remove('in');
  setTimeout(() => {
    if (run) return; // restarted meanwhile
    layer.hidden = true; card.hidden = true; delete document.documentElement.dataset.tour;
    document.documentElement.style.removeProperty('--tour-sheet-h');
    if (layer.parentNode !== document.body) document.body.append(layer, card);
  }, reduce() ? 0 : FADE);
  setTimeout(() => { // focus goes back where it was
    const ok = el => el && el !== document.body && el.isConnected && shown(el);
    [r.returnTo, $('tourPageKey'), $('helpBtn'), $('pagesBtn')].find(ok)?.focus?.({ preventScroll: true });
  }, 0);
  dispatchEvent(new CustomEvent('star-shift-tour-end', { detail: { how } }));
}

/** Can this chapter run here now? (at least one of its steps has its part on screen or can open it) */
export const canRun = ch => !!ch && ch.steps.some(planned);

/** For checks in the console: the current card and target rects. */
export function debugRects() {
  if (!run || !card) return null;
  const t = run.kind === 'step' ? rawRect(run.cur) : null;
  return { chapter: run.ch?.id, step: run.cur?.id, kind: run.kind, card: card.getBoundingClientRect().toJSON(), target: t };
}
export { readProgress, page as currentPage, scene as currentScene };
