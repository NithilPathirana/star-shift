// Guided tour entry point, loaded on every page by app/rail.js (and app/tour/tour.js on index.html).
// Injects its own stylesheet and keys: a Tour key in the top bar (desktop) whose menu, like the Pages sheet
// (phone, short windows), offers the 60-second tour, "Tour this page", "Take the full tour" and
// "Resume tour" when one was left mid-way, a Tour key in the
// Lab notebook, and on index.html the first-visit offer and Help's tour key. Resumes the full tour after
// it loads the next page.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { chapterForPage, chapterById, readProgress, shouldAutoResume, canResume, resumeLabel, clearProgress } from './chapters.js';
import { shouldOffer, remember, offerAllowed, OFFER_MS, PHONE_MAX, reducedMotion } from './steps.js';
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
const quickTour = from => start({ mode: 'quick', chapter: 'q-pick', returnTo: from }); // "Start tour": 6 steps, about a minute
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
  k.setAttribute('aria-label', 'Guided tours'); k.title = 'Guided tours'; k.setAttribute('aria-haspopup', 'menu');
  // a small menu: Resume (when a tour was left mid-way), the 60-second tour, this page, the full tour
  k.onclick = e => { e.stopPropagation(); toggleMenu(k); };
  const before = $('clarityBtn') && bar.contains($('clarityBtn')) ? $('clarityBtn') : bar.firstChild;
  bar.insertBefore(k, before);
}
let menu;
function closeMenu() { if (menu && !menu.hidden) { menu.hidden = true; $('tourPageKey')?.setAttribute('aria-expanded', 'false'); } }
function toggleMenu(k) {
  if (menu && !menu.hidden) return closeMenu();
  if (!menu) {
    menu = document.createElement('div'); menu.className = 'tour-menu glass'; menu.id = 'tourMenu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
    menu.innerHTML = `<button class="key primary" type="button" role="menuitem" data-tour="resume"></button>
      <button class="key" type="button" role="menuitem" data-tour="quick">60-second tour</button>
      <button class="key" type="button" role="menuitem" data-tour="page">Tour this page</button>
      <button class="key" type="button" role="menuitem" data-tour="full">Take the full tour</button>`;
    menu.addEventListener('click', e => {
      const b = e.target.closest('[data-tour]'); if (!b) return;
      e.stopPropagation(); closeMenu(); pick(b.dataset.tour, k);
    });
    document.body.append(menu);
    addEventListener('click', e => { if (!menu.contains(e.target) && e.target !== k) closeMenu(); });
    addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
    k.setAttribute('aria-controls', 'tourMenu');
  }
  const p = readProgress(getStore()), ok = canResume(p);
  const rk = menu.querySelector('[data-tour="resume"]'); rk.hidden = !ok; rk.textContent = ok ? resumeLabel(p) : '';
  menu.querySelector('[data-tour="quick"]').classList.toggle('primary', !ok);
  menu.hidden = false; k.setAttribute('aria-expanded', 'true');
  const r = k.getBoundingClientRect();
  menu.style.top = Math.round(r.bottom + 8) + 'px';
  menu.style.left = Math.round(Math.max(12, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 12))) + 'px';
  menu.querySelector('button:not([hidden])').focus();
}
const pick = (what, from) => what === 'quick' ? quickTour(from) : what === 'page' ? tourThisPage(from) : what === 'full' ? fullTour(from) : resume(from);
function sheetKeys() {
  const pop = $('pagesPop');
  if (!pop || pop.querySelector('.tour-sheet')) return;
  const box = document.createElement('div'); box.className = 'tour-sheet';
  box.innerHTML = `<h3>Guided tour</h3><div class="tour-sheet-keys">
    <button class="key" type="button" data-tour="quick">${ICON}60-second tour</button>
    <button class="key" type="button" data-tour="page">Tour this page</button>
    <button class="key" type="button" data-tour="full">Take the full tour</button>
    <button class="key primary" type="button" data-tour="resume" hidden></button></div>`;
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-tour]'); if (!b) return;
    e.stopPropagation(); closeSheet(); pick(b.dataset.tour, $('pagesBtn'));
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
  const k = $('tourPageKey');
  if (k) {
    if (ok) { k.dataset.resume = '1'; k.title = `${label}, or another tour`; k.setAttribute('aria-label', `Guided tours: ${label.toLowerCase()}`); }
    else { delete k.dataset.resume; k.title = 'Guided tours'; k.setAttribute('aria-label', 'Guided tours'); }
  }
  const sh = document.querySelector('.tour-sheet [data-tour="resume"]');
  if (sh) { sh.hidden = !ok; sh.textContent = label; }
}

/* ---------- index.html: the first-visit offer (judges' a5, design spec section 3) ---------- */
// Desktop only: a 296 px callout hanging under the Tour key, over the right panel, never over #stage.
// Phones get no card: agent M's story row carries a plain Tour key that calls StarShiftTour.quick().
// It leaves on the first pick, search or Play, the scene changing, or after 8 s (paused while
// hovered or focused); whichever way it leaves it is stored as seen, so it never comes back.
let offer, offerIv = 0, offerT = 0, offerLeft = OFFER_MS, offerT0 = 0, offerHeld = false;
const isPhone = () => innerWidth <= PHONE_MAX;
const firstUrl = (() => { try { return performance.getEntriesByType('navigation')[0]?.name || location.href; } catch { return location.href; } })();
const stageRect = () => $('stage')?.getBoundingClientRect();
const hits = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
function placeOffer() {
  if (!offer || offer.hidden) return true;
  const k = $('tourPageKey'), kr = k?.getBoundingClientRect(), tb = $('topbar')?.getBoundingClientRect();
  if (isPhone() || !kr || kr.width < 2) return false; // nothing to hang from: the key in the dock or the Pages sheet does the job
  const right = Math.max(12, Math.round(innerWidth - (tb ? tb.right : kr.right)));
  offer.style.top = Math.round(kr.bottom + 10) + 'px'; offer.style.right = right + 'px';
  const r = offer.getBoundingClientRect();
  if (hits(r, stageRect())) return false; // narrow windows: no right panel to lie on, so no card at all
  const nx = Math.round(kr.left + kr.width / 2 - r.left - 5);
  offer.style.setProperty('--notch-x', nx + 'px'); offer.style.transformOrigin = `${nx + 5}px 0`;
  return true;
}
const replaceOffer = () => { if (offer && !offer.hidden && !placeOffer()) leaveOffer(false); };
// the offer never sits over an open sheet, popover or dialog: it steps aside until it closes
const popOpen = () => !!document.querySelector('dialog[open]')
  || [...document.querySelectorAll('.pop:not([hidden])')].some(e => getComputedStyle(e).display !== 'none');
const serrOpen = () => { const e = $('serr'); return !!e && !e.hidden; };
function guardOffer() {
  if (!offer || offer.hidden) return;
  if ($('app')?.dataset.scene === 'viewer') return leaveOffer(false);
  offer.classList.toggle('aside', popOpen() || serrOpen()); replaceOffer();
}
// 8 s on screen, not counting while the pointer or keyboard focus is inside it
function holdOffer(on) {
  if (!offer || offer.hidden || on === offerHeld) return;
  offerHeld = on;
  if (on) { clearTimeout(offerT); offerLeft -= performance.now() - offerT0; }
  else { offerT0 = performance.now(); offerT = setTimeout(() => leaveOffer(false), Math.max(800, offerLeft)); }
}
function pulseKey() {
  const k = $('tourPageKey'); if (!k || reduceNow()) return;
  k.classList.remove('tour-pulse'); void k.offsetWidth; k.classList.add('tour-pulse');
  setTimeout(() => k.classList.remove('tour-pulse'), 700);
}
const reduceNow = () => {
  let raw = null; try { raw = localStorage.getItem('tgi-clarity-v1'); } catch { /* private mode */ }
  return reducedMotion({ clarityRaw: raw, datasetMotion: document.documentElement.dataset.motion, osReduce: matchMedia('(prefers-reduced-motion: reduce)').matches });
};
function leaveOffer(chose) {
  if (!offer || offer.hidden || offer.dataset.leaving) return;
  offer.dataset.leaving = '1';
  remember(getStore(), 'dismissed'); // seen: never offered again (starting a tour stores 'started' over it)
  clearInterval(offerIv); clearTimeout(offerT);
  removeEventListener('resize', replaceOffer); removeEventListener('click', onAppAct, true); removeEventListener('submit', onAppAct, true);
  offer.classList.remove('in');
  if (!chose) pulseKey();
  setTimeout(() => { offer.hidden = true; }, 150);
}
const hideOffer = () => leaveOffer(true);
// the visitor started doing something: a pick, a search, Play (map panel, dock, viewer) or the story key
function onAppAct(e) {
  if (offer?.contains(e.target)) return;
  if (e.type === 'submit' || e.target.closest?.('.pick, .pin, #cdPlay, #mdPlay, #play, #mapOpenFilm, .story-go, form.search button')) leaveOffer(false);
}
function showOffer() {
  if (running() || !shouldOffer(getStore()) || readProgress(getStore()) || !offerAllowed(firstUrl) || isPhone()) return;
  if ($('app')?.dataset.scene === 'viewer') return;
  offer = document.createElement('section'); offer.className = 'tour-offer glass'; offer.setAttribute('aria-labelledby', 'tourOfferT');
  offer.innerHTML = `<p class="tour-offer-t" id="tourOfferT">New here? Take a guided tour</p>
    <button class="key" type="button" id="tourGo">Start tour</button><button class="key icon tour-x" type="button" id="tourX" aria-label="Not now">✕</button>`;
  document.body.append(offer);
  offer.querySelector('#tourGo').onclick = () => { leaveOffer(true); quickTour($('tourPageKey')); };
  offer.querySelector('#tourX').onclick = () => leaveOffer(true);
  offer.addEventListener('pointerenter', () => holdOffer(true)); offer.addEventListener('pointerleave', () => holdOffer(offer.contains(document.activeElement)));
  offer.addEventListener('focusin', () => holdOffer(true)); offer.addEventListener('focusout', e => { if (!offer.contains(e.relatedTarget) && !offer.matches(':hover')) holdOffer(false); });
  addEventListener('click', onAppAct, true); addEventListener('submit', onAppAct, true);
  if (!placeOffer()) { removeEventListener('click', onAppAct, true); removeEventListener('submit', onAppAct, true); offer.remove(); offer = null; return; }
  addEventListener('resize', replaceOffer);
  guardOffer(); offerIv = setInterval(guardOffer, 250);
  // 8 s on screen, but gone by 9 s after the page opened (spec), and never shorter than 4 s
  offerT0 = performance.now(); offerLeft = Math.max(4000, Math.min(OFFER_MS, OFFER_MS + 1000 - offerT0));
  offerT = setTimeout(() => leaveOffer(false), offerLeft);
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
  addEventListener('star-shift-tour-start', () => { hideOffer(); closeMenu(); refreshResume(); });
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

// the phone story row's Tour key (agent M) and any other key: StarShiftTour.quick(key) or this event
addEventListener('star-shift-tour-quick', e => quickTour(e.detail?.from || document.activeElement));
window.StarShiftTour = {
  page: from => tourThisPage(from), full: from => fullTour(from), quick: from => quickTour(from), resume, end,
  start: () => fullTour(document.activeElement), // kept for the console and old hooks
  chapter: (id, mode = 'page') => chapterById(id) && start({ mode, chapter: id }),
  forget: () => { clearProgress(getStore()); refreshResume(); }, debug: debugRects,
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
