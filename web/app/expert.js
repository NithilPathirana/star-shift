// Simple / Expert mode, shared by every page (Master work order, Sun 07:10, item 5).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Default is Simple: plain-words values for a general audience. One remembered switch turns on
// Expert, which reveals the analysis detail (sexagesimal + degree coordinates, σ, χ², flag bit
// names, MJD, detector/channel, FITS header fields, raw counts, CSV export).
//
// Markup contract (any page):
//   class="x-only"  -> shown only in Expert mode
//   class="s-only"  -> shown only in Simple mode (e.g. the plain-words twin of an expert value)
//   Never put an honest verdict line (AGREES / NOT MEASURABLE / "no significant motion" / Spot's
//   verdict) inside .x-only.
// JS contract:
//   import { isExpert, setExpert, onExpert, expertSwitch } from './expert.js';
//   onExpert(fn) calls fn(isExpert()) now and on every change (also changes made in another tab).
//   expertSwitch() returns a ready <button role="switch"> wired to the setting.

const KEY = 'star-shift-expert-v1';
const listeners = new Set();
let on = false;
try { on = localStorage.getItem(KEY) === 'on'; } catch { /* private mode: Simple */ }

function apply() {
  document.documentElement.dataset.expert = on ? 'on' : 'off';
  document.querySelectorAll('.expert-sw').forEach(b => { b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); });
}

if (!document.getElementById('expert-css')) {
  const st = document.createElement('style');
  st.id = 'expert-css';
  st.textContent = 'html:not([data-expert=on]) .x-only{display:none!important}html[data-expert=on] .s-only{display:none!important}';
  document.head.appendChild(st);
}
apply();

export const isExpert = () => on;

export function setExpert(v) {
  on = !!v;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  apply();
  listeners.forEach(fn => { try { fn(on); } catch (e) { console.error(e); } });
}

export function onExpert(fn) { listeners.add(fn); fn(on); return () => listeners.delete(fn); }

addEventListener('storage', e => { if (e.key === KEY) { on = e.newValue === 'on'; apply(); listeners.forEach(fn => fn(on)); } });

// A small labelled switch: "Expert" with an on/off pill. Styling lives with whoever places it;
// it carries class "expert-sw" (and "on" when Expert is on).
export function expertSwitch(extraClass = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `expert-sw ${extraClass}`.trim();
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(on));
  b.title = 'Expert mode: show coordinates in full, uncertainties (σ), χ², MJD dates, detector and flag details, and CSV export';
  b.innerHTML = '<span class="expert-l">Expert</span><span class="expert-pill" aria-hidden="true"></span>';
  b.classList.toggle('on', on);
  b.onclick = () => setExpert(!on);
  return b;
}
