// b1: first-screen story on the cold-open map (design/spec-judge-fixes.md section 1).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// The story is in index.html and shown by html[data-story="on"] (set inline, so it is there at first paint).
// This module only takes it away (first map touch, search focus, preset, scene change, tour) and wires its keys.
// Stateless: no storage, it shows on every load that lands on the map.
import { findPreset } from './presets.js';
import { isExpert } from './expert.js';
const root = document.documentElement, $ = id => document.getElementById(id);
// Judging round 4, item 3: the CTA follows ?q. A preset in ?q is named and played; any other ?q or ?ra=&dec=
// gets "Play this patch"; no target in the address keeps Barnard's Star.
const QP = new URLSearchParams(location.search), QTEXT = QP.get('q') || (QP.get('ra') && QP.get('dec') ? 'coords' : '');
const CTA = QTEXT ? (QP.get('q') && findPreset(QP.get('q'))) || null : findPreset("Barnard's Star");
const VERB = { 'rw-aur': 'change', 'r-dra': 'change' }; // the two variable stars barely move; they brighten and fade
let driving = false; // true while the CTA presses a quick pick itself, so the quick-pick listener doesn't play it twice
const on = () => root.dataset.story === 'on';
const reduced = () => root.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;

let forTour = false; // the story left only because a tour started: it comes back when that tour ends
export function leaveStory() {
  forTour = false;
  if (!on()) return;
  const els = document.querySelectorAll('.story');
  els.forEach(e => e.classList.add('leaving'));
  setTimeout(() => { root.dataset.story = 'off'; els.forEach(e => e.classList.remove('leaving')); }, reduced() ? 0 : 180);
}

// The CTA: select its target on the map, then play it, in the page; a full load of the viewer link if the
// map is not ready (or the selection never arrives). p = a preset, or null for the ?q / ?ra=&dec= patch.
function viewerLink(p) {
  if (p) return `index.html?q=${encodeURIComponent(p.label)}&scene=viewer`;
  const q = new URLSearchParams(location.search); q.set('scene', 'viewer'); return `index.html?${q}`;
}
function waitThenPlay(isT, fallback, ms) {
  const t0 = performance.now();
  const iv = setInterval(() => {
    if (isT()) { clearInterval(iv); setTimeout(() => { if ($('app')?.dataset.scene === 'map') $('cdPlay')?.click(); }, 300); } // not if something else opened the viewer meanwhile
    else if (performance.now() - t0 > ms) { clearInterval(iv); fallback?.(); }
  }, 100);
}
function watchTarget(p) {
  leaveStory();
  const app = window.__app, link = viewerLink(p);
  const isT = () => (p ? app?.M?.sel?.t?.key === p.key : !!app?.M?.sel);
  if (!app?.skymap?.aladin) { location.assign(link); return; }
  if (isT()) { $('cdPlay')?.click(); return; }
  if (p) {
    const pick = [...document.querySelectorAll('.pick')].find(b => findPreset(b.textContent)?.key === p.key);
    if (!pick) { location.assign(link); return; }
    driving = true; try { pick.click(); } finally { driving = false; }
  }
  waitThenPlay(isT, () => location.assign(link), p ? 6000 : 15000); // a searched name waits for SIMBAD
}

// Quick picks (judging round 4, item 3): in Simple mode one click plays the star, the same path as the CTA;
// Expert mode keeps select-first (Play this patch over time). ui.js's own .pick handler does the selecting.
function onPick(e) {
  const b = e.target.closest?.('.pick');
  if (!b || driving || !e.isTrusted || isExpert()) return; // !isTrusted: the tour's own pick.click() keeps its own Play
  const p = findPreset(b.textContent), app = window.__app;
  if (!p || !app?.skymap?.aladin) return;
  waitThenPlay(() => app?.M?.sel?.t?.key === p.key, null, 8000);
}

function init() {
  document.querySelectorAll('.story-go').forEach(b => {
    if (QTEXT) { const name = CTA ? `Watch ${CTA.label} ${VERB[CTA.key] || 'move'}` : 'Play this patch'; b.firstChild.textContent = name + ' '; }
    b.onclick = () => watchTarget(CTA);
  });
  delete root.dataset.cta; // index.html hides the CTA's text until it names the ?q target (no flash of Barnard's Star)
  document.addEventListener('click', onPick); // bubbles after ui.js's .pick onclick has started the selection
  document.querySelectorAll('.story-tour').forEach(b => {
    // the full tour opens on the sky map's chapter, whose step 1 is this story's CTA: the story stays (round 7)
    b.onclick = () => { if (window.StarShiftTour?.full) window.StarShiftTour.full(b); else { leaveStory(); $('tourPageKey')?.click(); } };
  });
  if (!on()) return;
  const notStory = e => !e.target.closest?.('.story');
  const layer = $('mapLayer');
  layer?.addEventListener('pointerdown', e => { if (notStory(e)) leaveStory(); });
  layer?.addEventListener('wheel', e => { if (notStory(e)) leaveStory(); }, { passive: true });
  $('mapWrap')?.addEventListener('keydown', leaveStory);
  $('tools')?.addEventListener('click', e => { if (e.target.closest?.('button')) leaveStory(); }); // zoom +/-/fit sit outside #mapLayer
  document.addEventListener('submit', e => { if (e.target.closest?.('form.search')) leaveStory(); }, true);
  $('q')?.addEventListener('focus', leaveStory); // typing a search: the story goes and Show is the copper key again
  document.addEventListener('click', e => { if (e.target.closest?.('.pick')) leaveStory(); }, true);
  // only a tour the visitor starts moves the story aside, and never the sky map's own tour (its step 1 is the CTA);
  // when that tour ends on the map, the hero card and CTA come back (Judging panel round 7)
  addEventListener('star-shift-tour-start', e => {
    const d = e.detail || {};
    if (d.auto || d.chapter === 'map' || !on()) return;
    leaveStory(); forTour = true; // any later leaveStory (a pick, a search, the viewer) clears it
  });
  addEventListener('star-shift-tour-end', () => {
    if (!forTour) return; forTour = false;
    if ($('app')?.dataset.scene === 'map') root.dataset.story = 'on';
  });
  const app = $('app');
  if (app) new MutationObserver(() => { if (app.dataset.scene !== 'map') leaveStory(); }).observe(app, { attributes: true, attributeFilter: ['data-scene'] });
}
init();
