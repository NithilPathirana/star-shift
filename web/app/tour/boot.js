// Guided tour entry point, loaded on every page by app/rail.js (and app/tour/tour.js on index.html).
// Injects its own stylesheet and keys: "Tour this page" in the top bar (desktop) and in the Pages sheet
// (phone, short windows), "Take the full tour", "Resume tour" when one was left mid-way, a Tour key in the
// Lab notebook, and on index.html the first-visit offer and Help's tour key. Resumes the full tour after
// it loads the next page.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { chapterForPage, chapterById, readProgress, shouldAutoResume, canResume, resumeLabel, clearProgress } from './chapters.js';
import { shouldOffer, remember, PHONE_MAX } from './steps.js';
import { start, end, running, getStore, currentPage, currentScene, debugRects } from './engine.js';

const $ = id => document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));
const page = currentPage();
const nbOpen = () => !!document.querySelector('dialog.notebook-dialog[open]');
const ICON = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M12.8 7.2l-1.7 3.9-3.9 1.7 1.7-3.9z" stroke-linejoin="round"/></svg>';

/* ---------- stylesheet ---------- */
function css() {
  if (document.querySelector('link[href*="styles/tour.css"]')) return;
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('../../styles/tour.css', import.meta.url).href }));
}

/* ---------- starting ---------- */
function tourThisPage(from) {
  const ch = chapterForPage(page, { scene: currentScene(), notebookOpen: nbOpen() });
  if (ch) start({ mode: 'page', chapter: ch.id, returnTo: from });
}
const fullTour = from => start({ mode: 'full', chapter: 'map', intro: true, returnTo: from });
function resume(from) {
  const p = readProgress(getStore()); if (!canResume(p)) return;
  start({ mode: p.mode, chapter: p.chapter, step: p.step, returnTo: from });
}
// keys inside the Pages sheet close it first (the page's own toggle), then start
const closeSheet = () => { const pop = $('pagesPop'); if (pop && !pop.hidden) $('pagesBtn')?.click(); };

/* ---------- keys ---------- */
function topKeys() {
  const bar = document.querySelector('.topbar .top-actions');
  if (!bar || $('tourPageKey')) return;
  const k = document.createElement('button');
  k.className = 'key tour-page-key'; k.id = 'tourPageKey'; k.type = 'button';
  k.innerHTML = `${ICON}<span class="tp-l">Tour</span>`;
  k.setAttribute('aria-label', 'Tour this page'); k.title = 'A short guided tour of this page';
  k.onclick = e => { e.stopPropagation(); tourThisPage(k); };
  const r = document.createElement('button');
  r.className = 'key tour-resume-key'; r.id = 'tourResumeKey'; r.type = 'button'; r.hidden = true;
  r.onclick = e => { e.stopPropagation(); resume(r); };
  const before = $('clarityBtn') && bar.contains($('clarityBtn')) ? $('clarityBtn') : bar.firstChild;
  bar.insertBefore(r, before); bar.insertBefore(k, before);
}
function sheetKeys() {
  const pop = $('pagesPop');
  if (!pop || pop.querySelector('.tour-sheet')) return;
  const box = document.createElement('div'); box.className = 'tour-sheet';
  box.innerHTML = `<h3>Guided tour</h3><div class="tour-sheet-keys">
    <button class="key" type="button" data-tour="page">${ICON}Tour this page</button>
    <button class="key" type="button" data-tour="full">Take the full tour</button>
    <button class="key primary" type="button" data-tour="resume" hidden></button></div>`;
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-tour]'); if (!b) return;
    e.stopPropagation(); closeSheet();
    const from = $('pagesBtn');
    if (b.dataset.tour === 'page') tourThisPage(from); else if (b.dataset.tour === 'full') fullTour(from); else resume(from);
  });
  const list = pop.querySelector('.pages-list');
  if (list) list.after(box); else pop.append(box);
}
function helpKey() { // index.html: Help's "Take the tour" now starts the full tour
  const b = $('tourStart'); if (!b || b.dataset.tourWired) return;
  b.dataset.tourWired = '1'; b.textContent = 'Take the full tour';
  b.addEventListener('click', e => {
    e.stopPropagation();
    if ($('help') && !$('help').hidden) $('helpBtn')?.click(); // ui.js closes its own popover
    fullTour($('helpBtn'));
  });
}
function notebookKey() { // a Tour key in the Lab notebook header, whenever the dialog exists
  const add = () => {
    const head = document.querySelector('dialog.notebook-dialog .notebook-header');
    if (!head || head.querySelector('.tour-nb-key')) return;
    const k = document.createElement('button'); k.className = 'notebook-small-key tour-nb-key'; k.type = 'button';
    k.innerHTML = `${ICON}<span>Tour</span>`; k.setAttribute('aria-label', 'Tour the lab notebook');
    k.onclick = () => start({ mode: 'page', chapter: 'notebook', returnTo: k });
    head.insertBefore(k, head.querySelector('.notebook-close'));
  };
  add();
  new MutationObserver(add).observe(document.body, { childList: true });
}
function refreshResume() {
  const p = readProgress(getStore()), ok = canResume(p) && !running();
  const label = ok ? resumeLabel(p) : '';
  const top = $('tourResumeKey');
  if (top) { top.hidden = !ok; top.textContent = ok ? 'Resume tour' : ''; top.title = label; top.setAttribute('aria-label', label); }
  const sh = document.querySelector('.tour-sheet [data-tour="resume"]');
  if (sh) { sh.hidden = !ok; sh.textContent = label; }
}

/* ---------- index.html: the first-visit offer ---------- */
let offer;
const isPhone = () => innerWidth <= PHONE_MAX;
function placeOffer() {
  if (!offer || offer.hidden) return;
  if (isPhone()) { // one 56 px strip just under the top bar, clear of the dock's Play key
    const tb = $('topbar')?.getBoundingClientRect();
    offer.classList.add('strip'); offer.style.cssText = `top:${Math.round((tb ? tb.bottom : 0) + scrollY + 8)}px`;
    return;
  }
  offer.classList.remove('strip'); offer.style.cssText = '';
  const st = $('stage')?.getBoundingClientRect(); if (!st) return;
  const ip = $('insp'), ir = ip && ip.offsetParent ? ip.getBoundingClientRect() : null;
  const edge = ir && ir.left > st.left && ir.left < st.right ? ir.left : st.right;
  offer.style.right = Math.max(12, innerWidth - edge + 16) + 'px';
  offer.style.bottom = Math.max(12, innerHeight - st.bottom + 72) + 'px';
}
function hideOffer() {
  if (!offer || offer.hidden) return;
  offer.classList.remove('in'); removeEventListener('resize', placeOffer);
  setTimeout(() => { offer.hidden = true; }, 180);
}
function showOffer() {
  if (running() || !shouldOffer(getStore()) || readProgress(getStore())) return;
  offer = document.createElement('section'); offer.className = 'tour-offer glass'; offer.setAttribute('aria-labelledby', 'tourOfferT');
  offer.innerHTML = `<p class="tour-offer-t" id="tourOfferT">New here? Take a guided tour</p>
    <div class="tour-actions"><button class="key tour-later" type="button" id="tourLater">Not now</button><button class="key primary" type="button" id="tourGo"><span class="o-lg">Start tour</span><span class="o-sm">Tour</span></button><button class="key icon tour-x" type="button" id="tourX" aria-label="Not now">✕</button></div>`;
  document.body.append(offer);
  offer.querySelector('#tourGo').onclick = () => { hideOffer(); fullTour($('tourPageKey')); };
  const later = () => { remember(getStore(), 'dismissed'); hideOffer(); };
  offer.querySelector('#tourLater').onclick = later; offer.querySelector('#tourX').onclick = later;
  placeOffer(); addEventListener('resize', placeOffer);
  void offer.offsetWidth; offer.classList.add('in');
}

/* ---------- wiring ---------- */
async function settle() { // let the page draw its first content before a resumed tour measures it
  const t0 = performance.now();
  if (page === 'index.html') {
    while (performance.now() - t0 < 6000 && !(window.__app?.skymap?.aladin || ($('stMap') && !$('stMap').hidden)) && !($('app')?.dataset.scene === 'viewer')) await wait(150);
  }
  await wait(page === 'index.html' ? 500 : 900);
}
async function init() {
  css(); topKeys(); sheetKeys(); helpKey(); notebookKey(); refreshResume();
  addEventListener('star-shift-tour-end', () => { refreshResume(); });
  addEventListener('star-shift-tour-start', () => { hideOffer(); refreshResume(); });
  const p = readProgress(getStore());
  if (shouldAutoResume(p, page)) {
    await settle();
    if (!running()) start({ mode: p.mode, chapter: p.chapter, step: p.step, intro: !!p.intro });
    refreshResume();
    return;
  }
  if (page === 'index.html') { // the offer, once the map is ready (or failed) and no loader is on screen
    const t0 = performance.now();
    while (performance.now() - t0 < 30000 && !((window.__app?.skymap?.aladin || ($('stMap') && !$('stMap').hidden) || performance.now() - t0 > 5000) && $('stLoading')?.hidden !== false)) await wait(150);
    await wait(700);
    showOffer();
  }
}

window.StarShiftTour = {
  page: from => tourThisPage(from), full: from => fullTour(from), resume, end,
  start: () => fullTour(document.activeElement), // kept for the console and old hooks
  chapter: (id, mode = 'page') => chapterById(id) && start({ mode, chapter: id }),
  forget: () => { clearProgress(getStore()); refreshResume(); }, debug: debugRects,
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
