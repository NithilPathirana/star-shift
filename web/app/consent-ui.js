// The consent bar (first visit) and Clarity → "Privacy & tutorials" (spec design/spec-tutorials-consent.md).
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
