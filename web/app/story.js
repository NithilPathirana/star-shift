// b1: first-screen story on the cold-open map (design/spec-judge-fixes.md section 1).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// The story is in index.html and shown by html[data-story="on"] (set inline, so it is there at first paint).
// This module only takes it away (first map touch, search focus, preset, scene change, tour) and wires its keys.
// Stateless: no storage, it shows on every load that lands on the map.
const root = document.documentElement, $ = id => document.getElementById(id);
const BARNARD = "Barnard's Star", DEMO = "index.html?q=Barnard%27s%20Star&scene=viewer";
const on = () => root.dataset.story === 'on';
const reduced = () => root.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;

export function leaveStory() {
  if (!on()) return;
  const els = document.querySelectorAll('.story');
  els.forEach(e => e.classList.add('leaving'));
  setTimeout(() => { root.dataset.story = 'off'; els.forEach(e => e.classList.remove('leaving')); }, reduced() ? 0 : 180);
}

// "Watch Barnard's Star move": select it on the map, then play it, in the page; a full load of the
// demo link if the map is not ready (or the selection never arrives).
function watchBarnard() {
  leaveStory();
  const app = window.__app, isB = () => app?.M?.sel?.t?.name === BARNARD;
  if (!app?.skymap?.aladin) { location.assign(DEMO); return; }
  const play = () => $('cdPlay')?.click();
  if (isB()) { play(); return; }
  const pick = [...document.querySelectorAll('.pick')].find(b => b.textContent.trim() === BARNARD);
  if (!pick) { location.assign(DEMO); return; }
  pick.click();
  const t0 = performance.now();
  const iv = setInterval(() => {
    if (isB()) { clearInterval(iv); setTimeout(play, 300); }
    else if (performance.now() - t0 > 6000) { clearInterval(iv); location.assign(DEMO); }
  }, 100);
}

function init() {
  document.querySelectorAll('.story-go').forEach(b => { b.onclick = watchBarnard; });
  document.querySelectorAll('.story-tour').forEach(b => {
    b.onclick = () => { leaveStory(); if (window.StarShiftTour?.full) window.StarShiftTour.full(b); else $('tourPageKey')?.click(); };
  });
  if (!on()) return;
  const notStory = e => !e.target.closest?.('.story');
  const layer = $('mapLayer');
  layer?.addEventListener('pointerdown', e => { if (notStory(e)) leaveStory(); });
  layer?.addEventListener('wheel', e => { if (notStory(e)) leaveStory(); }, { passive: true });
  $('mapWrap')?.addEventListener('keydown', leaveStory);
  document.addEventListener('submit', e => { if (e.target.closest?.('form.search')) leaveStory(); }, true);
  $('q')?.addEventListener('focus', leaveStory); // typing a search: the story goes and Show is the copper key again
  document.addEventListener('click', e => { if (e.target.closest?.('.pick')) leaveStory(); }, true);
  addEventListener('star-shift-tour-start', leaveStory);
  const app = $('app');
  if (app) new MutationObserver(() => { if (app.dataset.scene !== 'map') leaveStory(); }).observe(app, { attributes: true, attributeFilter: ['data-scene'] });
}
init();
