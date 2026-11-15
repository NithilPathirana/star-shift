// The consent ask and Clarity → "Privacy & tutorials" (spec design/spec-tutorials-consent.md).
// No bar on page load (Judging panel round 7): mountAsk() shows a small inline prompt next to what the visitor touched,
// the first time they change something optional (consent.js fires 'star-shift-consent-needed'). showBar stays for old hooks.
// The gate itself is app/consent.js (classic script in <head>); this only asks and shows the choice.
// The bar sits at the bottom, never over the main key, the transport or the dock (it docks under the top bar instead).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { resetTutorials } from './tour/progress.js';
import { clearProgress } from './tour/chapters.js';
import { notebookToMarkdown } from './notebook/export.js';

const C = () => window.StarShiftConsent;
const $ = id => document.getElementById(id);
const store = () => { try { return window.localStorage; } catch { return null; } };
export const consentDecided = () => !C()?.decided || C().decided(); // no gate on this page: nothing to ask
const NEC = 'Always on: this choice, tutorial progress, Simple or Expert, text size and comfort options, and the view you are on.';
const PER = 'Remembers your colour look, image and mark colours, IR band ranges, flag choices and the Lab notebook across visits. Off: they last for this visit only.';
const NB_KEY = 'star-shift-lab-notebooks-v1';
// Reject or withdrawing never deletes silently: the data is kept for this tab (consent.js) and this line says so
function keptNote() {
  const left = C()?.visitOnly?.() || []; if (!left.length || C()?.personal?.()) return '';
  const nb = left.includes(NB_KEY);
  return `<span>Your saved ${nb ? 'notebook and settings' : 'settings'} will be cleared when you close this tab</span>${nb ? ' · <button class="ssc-link" type="button" data-c="export">Export notebook</button>' : ''}`;
}
// the notebook's own Markdown export (notebook/export.js), every notebook in one file
function exportNotebook() {
  let st = null; try { st = JSON.parse(store()?.getItem(NB_KEY) || 'null'); } catch { st = null; }
  const books = Array.isArray(st?.notebooks) ? st.notebooks : [];
  const md = books.length ? books.map(b => notebookToMarkdown(b)).join('\n\n---\n\n') : '# Lab notebook\n\n_No captured values._';
  const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'star-shift-lab-notebook.md' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
const sw = (on, attrs) => `<button class="switch well" type="button" role="switch" aria-checked="${on}" ${attrs}><i></i></button>`;

/** Resolves once a consent choice is saved (at once when it already is). */
export function consentReady() {
  if (consentDecided()) return Promise.resolve();
  return new Promise(res => addEventListener('star-shift-consent', function f() { if (consentDecided()) { removeEventListener('star-shift-consent', f); res(); } }));
}

/* ---------- the bar ---------- */
const GUARD = '.story-go, #play, .transport, .tl, #mdPlay, #cdPlay, .dock, #mapOpenFilm, .key.primary';
let bar, iv = 0;
const visible = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden' ? r : null; };
const hits = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
// bottom first; if that covers a guarded part, just above it (e.g. above the dock); else under the top bar
function place() {
  if (!bar || bar.hidden) return;
  const tb = document.querySelector('.topbar')?.getBoundingClientRect(), topMin = (tb && tb.bottom > 0 ? tb.bottom : 0) + 8;
  const clash = () => { const r = bar.getBoundingClientRect(); return [...document.querySelectorAll(GUARD)].map(e => !bar.contains(e) && visible(e)).filter(g => g && hits(r, g)); };
  bar.classList.remove('top'); bar.style.top = ''; bar.style.bottom = '';
  for (let k = 0; k < 3; k++) {
    const c = clash(); if (!c.length) return;
    const up = innerHeight - Math.min(...c.map(g => g.top)) + 8;
    bar.style.bottom = Math.round(up) + 'px';
    if (bar.getBoundingClientRect().top < topMin) break;
  }
  if (!clash().length && bar.getBoundingClientRect().top >= topMin) return;
  bar.style.bottom = ''; bar.classList.add('top'); bar.style.top = Math.round(topMin) + 'px';
}
function closeBar(choice) {
  if (!bar) return;
  if (choice !== null) {
    C()?.choose(choice);
    const note = keptNote();
    if (note) { // the bar stays as a one-line note (with Export notebook) until OK; the tutorial waits for it
      bar.innerHTML = `<p class="ssc-t ssc-kept" id="sscT">${note}</p><div class="ssc-keys"><button class="key" type="button" data-c="ok">OK</button></div>`;
      syncSettings(); place(); bar.querySelector('[data-c=ok]').focus(); return;
    }
  }
  clearInterval(iv); removeEventListener('resize', place);
  bar.classList.remove('in');
  const b = bar; bar = null;
  setTimeout(() => b.remove(), document.documentElement.dataset.motion === 'reduce' ? 0 : 160);
  syncSettings();
}
export function showBar() {
  if (bar || consentDecided()) return;
  bar = document.createElement('section');
  bar.className = 'ss-consent glass'; bar.id = 'ssConsent'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-labelledby', 'sscT');
  bar.innerHTML = `<p class="ssc-t" id="sscT"><b>Your settings, your choice.</b> Star Shift keeps a few settings in this browser's storage. No cookies, and we don't use analytics or tracking.</p>
    <div class="ssc-more" id="sscMore" hidden>
      <div class="opt"><span>Necessary<small>${NEC}</small></span>${sw(true, 'disabled aria-label="Necessary storage, always on"')}</div>
      <div class="opt"><span>Personalisation<small>${PER}</small></span>${sw(false, 'data-consent="personal" aria-label="Personalisation"')}</div>
    </div>
    <div class="ssc-keys"><button class="key" type="button" data-c="custom" aria-expanded="false" aria-controls="sscMore">Customize</button>
      <button class="key" type="button" data-c="reject">Reject optional</button><button class="key" type="button" data-c="accept">Accept all</button></div>`;
  bar.addEventListener('click', e => {
    const s = e.target.closest('[data-consent]'); if (s) { s.setAttribute('aria-checked', s.getAttribute('aria-checked') !== 'true'); return; }
    const b = e.target.closest('[data-c]'); if (!b) return;
    if (b.dataset.c === 'export') return exportNotebook();
    if (b.dataset.c === 'ok') return closeBar(null);
    if (b.dataset.c === 'accept') closeBar(true);
    else if (b.dataset.c === 'reject') closeBar(false);
    else if (b.dataset.c === 'save') closeBar(bar.querySelector('[data-consent]').getAttribute('aria-checked') === 'true');
    else { // Customize: show the two categories; the key becomes "Save choice"
      $('sscMore').hidden = false; b.dataset.c = 'save'; b.textContent = 'Save choice'; b.setAttribute('aria-expanded', 'true');
      place(); bar.querySelector('[data-consent]').focus();
    }
  });
  document.body.append(bar);
  addEventListener('resize', place); iv = setInterval(place, 400); place();
  void bar.offsetWidth; bar.classList.add('in');
}

/* ---------- the inline ask: only when something optional is first changed ---------- */
let ask = null, askOff = false, lastEl = null;
function anchorRect() {
  const a = document.activeElement, el = a && a !== document.body && a.isConnected ? a : lastEl?.isConnected ? lastEl : null;
  const r = el?.getBoundingClientRect(); return r && r.width > 1 ? r : null;
}
function placeAsk() {
  if (!ask) return;
  const w = ask.offsetWidth, h = ask.offsetHeight, r = anchorRect(), m = 8;
  let top, left;
  if (r) {
    top = r.bottom + m + h <= innerHeight - m ? r.bottom + m : Math.max(m, r.top - m - h);
    left = Math.min(Math.max(m, r.left), innerWidth - w - m);
  } else { top = innerHeight - h - 16; left = innerWidth - w - 16; }
  ask.style.top = Math.round(Math.max(m, top)) + 'px'; ask.style.left = Math.round(Math.max(m, left)) + 'px';
}
function closeAsk(choice) {
  if (!ask) return;
  if (choice !== null) C()?.choose(choice); else askOff = true; // ✕: not asked again on this page view
  const a = ask; ask = null; a.remove(); syncSettings();
}
function openPrivacy() {
  closeAsk(null);
  const btn = $('clarityBtn'); if (!btn) return;
  if ($('clarity')?.hidden !== false) btn.click();
  setTimeout(() => { const s = $('sscSet'); s?.scrollIntoView({ block: 'nearest' }); s?.querySelector('[data-consent]')?.focus({ preventScroll: true }); }, 60);
}
export function showAsk() {
  if (ask || askOff || consentDecided()) return;
  ask = document.createElement('div');
  ask.className = 'ss-ask glass'; ask.id = 'ssAsk'; ask.setAttribute('role', 'dialog'); ask.setAttribute('aria-labelledby', 'ssAskT');
  ask.innerHTML = `<p class="ss-ask-t" id="ssAskT">Remember this on this device?</p>
    <div class="ss-ask-keys"><button class="key primary" type="button" data-a="yes">Yes</button><button class="key" type="button" data-a="visit">Just this visit</button>
    <button class="key icon ss-ask-x" type="button" data-a="x" aria-label="Ask me later">✕</button></div>
    <p class="ss-ask-n">No cookies, no tracking.${$('clarityBtn') ? ' <button class="ssc-link" type="button" data-a="privacy">Privacy settings</button>' : ''}</p>`;
  ask.addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'privacy') openPrivacy(); else closeAsk(a === 'yes' ? true : a === 'visit' ? false : null);
  });
  ask.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeAsk(null); } });
  document.body.append(ask); placeAsk();
}
export function mountAsk() {
  if (mountAsk.done) return; mountAsk.done = true;
  addEventListener('pointerdown', e => { if (!ask?.contains(e.target)) lastEl = e.target.closest?.('button, input, select, label, [role], canvas') || e.target; }, true);
  addEventListener('star-shift-consent-needed', () => showAsk());
  addEventListener('resize', placeAsk);
}

/* ---------- the consent chip (Nithil, Sun 21:55): a first visit can always choose ---------- */
// Small, at the bottom, never over the stage, the result plate or a verdict: bottom-left, else bottom-right, else
// in flow as the top bar's last row. Hidden while a tour is open; gone for good once a choice is saved.
const KEEP = 'h1, h2, h3, .rail, #stage, #resultPlate, #verdict, .sm-verdict, #rpRes, .transport, .tl, .dock, #cdPlay, #mdPlay, .story-go, .story, #plot, #cv';
let cc = null, ccIv = 0;
function placeCC() {
  if (!cc) return;
  if (consentDecided()) return closeCC();
  cc.hidden = document.documentElement.dataset.tour === 'on';
  if (cc.hidden) return;
  const guards = () => [...document.querySelectorAll(KEEP)].filter(e => !cc.contains(e)).map(visible).filter(Boolean);
  const free = () => { const r = cc.getBoundingClientRect(); return !guards().some(g => hits(r, g)); };
  if (cc.parentNode !== document.body) document.body.append(cc);
  cc.classList.remove('in-bar', 'right', 'foot', 'on-map'); cc.style.bottom = '';
  if (onMap()) return;
  if (free()) return;
  cc.classList.add('right'); if (free()) return;
  cc.classList.remove('right');
  // no free corner: in flow as the top bar's last row (never over content)
  const bar = document.querySelector('.topbar');
  if (bar) { cc.classList.add('in-bar'); bar.append(cc); } else cc.classList.add('foot');
}
// Phones, sky-map scene (coding lead, round 9): over the lower part of the sky picture, above the dock, clear of
// the hero card, its CTA, the map readout and any heading; a row in the top bar would push the CTA below the fold
const MAPKEEP = 'h1, h2, h3, .story, .story-go, .story-tour, #mapRead, .coords, .dock, .topbar, #mdPlay, .transport';
function onMap() {
  const st = innerWidth <= 699 && $('app')?.dataset.scene === 'map' && $('stage') && visible($('stage'));
  if (!st) return false;
  const clash = () => { const r = cc.getBoundingClientRect(); return [...document.querySelectorAll(MAPKEEP)].filter(e => !cc.contains(e)).map(visible).filter(g => g && hits(r, g)); };
  cc.classList.add('on-map');
  let bottom = innerHeight - Math.min(st.bottom, innerHeight) + 8;
  for (let k = 0; k < 4; k++) {
    cc.style.bottom = Math.round(bottom) + 'px';
    const r = cc.getBoundingClientRect(), c = clash();
    if (r.top < st.top) break;
    if (!c.length) return true;
    bottom = innerHeight - Math.min(...c.map(g => g.top)) + 8; // lift it above whatever it touched
  }
  cc.classList.remove('on-map'); cc.style.bottom = ''; return false;
}
function closeCC() {
  clearInterval(ccIv); removeEventListener('resize', placeCC);
  cc?.remove(); cc = null;
}
export function showConsentChip() {
  if (cc || consentDecided()) return;
  cc = document.createElement('div');
  cc.className = 'ss-cc glass'; cc.id = 'ssCC'; cc.setAttribute('role', 'region'); cc.setAttribute('aria-label', 'Privacy choice');
  cc.innerHTML = `<span class="ss-cc-t">Privacy: nothing personal is stored</span>
    <button class="ssc-link" type="button" data-cc="accept">Accept all</button><span aria-hidden="true">·</span>
    <button class="ssc-link" type="button" data-cc="reject">Reject optional</button><span aria-hidden="true">·</span>
    <button class="ssc-link" type="button" data-cc="custom">Customise</button>`;
  cc.addEventListener('click', e => {
    const b = e.target.closest('[data-cc]'); if (!b) return;
    e.stopPropagation();
    if (b.dataset.cc === 'custom') { if ($('clarityBtn')) openPrivacy(); return; }
    C()?.choose(b.dataset.cc === 'accept'); closeAsk(null); closeCC(); syncSettings();
  });
  document.body.append(cc);
  addEventListener('resize', placeCC); ccIv = setInterval(placeCC, 500); placeCC();
  addEventListener('star-shift-consent', () => { if (consentDecided()) closeCC(); });
}

/* ---------- Clarity → Privacy & tutorials ---------- */
function syncSettings() {
  const s = document.querySelector('#sscSet [data-consent]');
  if (s) s.setAttribute('aria-checked', !!C()?.personal?.());
  const k = $('sscKept'); if (k) k.innerHTML = keptNote(); // under the switch while data lives only in this tab
}
export function mountSettings() {
  const pop = $('clarity'); if (!pop || $('sscSet')) return;
  const box = document.createElement('div'); box.className = 'ssc-set'; box.id = 'sscSet';
  box.innerHTML = `<h3>Privacy &amp; tutorials</h3>
    <div class="opt"><span>Necessary storage<small>${NEC}</small></span>${sw(true, 'disabled aria-label="Necessary storage, always on"')}</div>
    <div class="opt"><span>Personalisation<small>${PER} Turning it off keeps what was saved until you close this tab.</small></span>${sw(!!C()?.personal?.(), 'data-consent="personal" aria-label="Personalisation"')}</div>
    <p class="ssc-note" id="sscKept">${keptNote()}</p>
    <p class="ssc-note">No cookies. We don't use analytics or tracking.</p>
    <div class="ssc-row"><button class="key" type="button" data-c="tours">Reset tutorial progress</button><button class="key" type="button" data-c="clear">Clear saved data now</button></div>
    <div class="ssc-confirm" id="sscConfirm" hidden><p class="ssc-note">This deletes your Lab notebook and every saved setting in this browser, now. It can't be undone.</p>
      <div class="ssc-row"><button class="key" type="button" data-c="export">Export notebook</button><button class="key" type="button" data-c="cancel">Cancel</button><button class="key" type="button" data-c="clear-yes">Clear now</button></div></div>
    <p class="ssc-note" id="sscSaid" aria-live="polite"></p>`;
  box.addEventListener('click', e => {
    e.stopPropagation(); // the popover stays open
    const say = t => { $('sscSaid').textContent = t; };
    const s = e.target.closest('[data-consent]');
    if (s) { const on = s.getAttribute('aria-checked') !== 'true'; C()?.choose(on); syncSettings(); say(on ? 'Personalisation is on: your choices are kept on this device.' : 'Personalisation is off: nothing optional is kept after this tab closes.'); return; }
    const b = e.target.closest('[data-c]'); if (!b) return;
    if (b.dataset.c === 'tours') {
      resetTutorials(store()); clearProgress(store()); try { store()?.removeItem('star-shift-tour-v1'); } catch { /* private mode */ }
      say('Done: each tutorial starts again the next time you open its page.');
    } else if (b.dataset.c === 'export') exportNotebook();
    else if (b.dataset.c === 'clear') { $('sscConfirm').hidden = false; $('sscConfirm').querySelector('[data-c=cancel]').focus(); }
    else if (b.dataset.c === 'cancel') { $('sscConfirm').hidden = true; b.closest('.ssc-set').querySelector('[data-c=clear]').focus(); }
    else if (b.dataset.c === 'clear-yes') { C()?.clearAll(); location.reload(); }
  });
  const foot = pop.querySelector('.foot');
  foot ? pop.insertBefore(box, foot) : pop.append(box);
  addEventListener('star-shift-consent', syncSettings);
}
