// Gaia overlay on the viewer's frames (judging panel b9): small circles where each Gaia DR3 star
// should be on the date of the image on screen (its 2016.0 position moved by its proper motion,
// core/motion.js propagate). Off by default; asks for the field's stars only when switched on.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { gaiaCone } from '../core/resolve.js';
import { prebakedFetch, hasPrebaked } from '../core/prebaked.js';
import { propagate } from '../core/motion.js';
import { worldToGrid } from '../core/align.js';

export const GAIA_OVERLAY_MAX = 40;    // brightest stars drawn per image
export const GAIA_OVERLAY_GMAX = 19.5; // as Spot (spot/logic.js GAIA_MAG_LIMIT): fainter ones SPHEREx won't show
// The five demo targets reuse Spot's saved field cone (spot/checks.js fetchFieldStars: 150″ + 110″,
// top 1000, centred on Spot's field), so they answer from web/prebaked/ and never go live.
export const DEMO_CONES = {
  barnard: [269.446229, 4.768703], 'wise-0855': [133.760098, -7.24221], 'eps-indi-b': [331.096733, -56.800671],
  'rw-aur': [76.956587, 30.40129], 'r-dra': [248.167233, 66.755024],
};
const DEMO_RADIUS = 260, DEMO_TOP = 1000;

// Gaia rows (resolve.js gaiaCone) -> the brightest `max` stars inside the grid on date mjd, as grid
// pixels { x, y } (same frame as align.js worldToGrid, so they sit on the canvas like the ring).
export function gaiaMarks(stars, grid, mjd, { max = GAIA_OVERLAY_MAX, gMax = GAIA_OVERLAY_GMAX } = {}) {
  if (!grid || !Number.isFinite(mjd)) return [];
  const n = grid.n, out = [];
  for (const s of stars || []) {
    if (!Number.isFinite(s.ra) || !Number.isFinite(s.dec) || (s.g != null && s.g > gMax)) continue;
    const p = propagate({ ra: s.ra, dec: s.dec, pmra: s.pmra || 0, pmdec: s.pmdec || 0, epoch: s.epoch ?? 2016.0 }, mjd);
    const [x, y] = worldToGrid(grid, p.ra, p.dec);
    if (!(x >= -0.5 && y >= -0.5 && x <= n - 0.5 && y <= n - 0.5)) continue;
    out.push({ id: s.id, g: s.g, x, y });
  }
  return out.sort((a, b) => (a.g ?? 99) - (b.g ?? 99)).slice(0, max);
}

// The field's Gaia stars: a demo target from its saved cone only (no live request), else one live cone.
export async function fieldGaia({ grid, preset, base, signal }) {
  const endpoint = `${base}/gaia/tap/sync`, demo = DEMO_CONES[preset];
  if (demo) {
    const savedOnly = async (url, init) => {
      if (!(await hasPrebaked(url))) throw new Error('not saved for this demo star');
      return prebakedFetch(url, init);
    };
    return gaiaCone(demo[0], demo[1], DEMO_RADIUS, { endpoint, fetchFn: savedOnly, top: DEMO_TOP, signal });
  }
  const r = Math.ceil((grid.n * grid.scale / 2) * Math.SQRT2 + 30); // corners, plus room for motion since 2016
  return gaiaCone(grid.ra0, grid.dec0, r, { endpoint, fetchFn: prebakedFetch, top: 200, signal });
}

const NS = 'http://www.w3.org/2000/svg';
const NOTE_OFF = 'Circles the brightest Gaia DR3 stars where they should be on this image\'s date.';

// cv: the stage canvas; sw: the switch; note: one line under it (always shown, so nothing moves);
// view(): { show, grid, mjd, cell, preset } for the image on cv right now.
export function createGaiaOverlay({ cv, sw, note, base, view }) {
  let on = false, key = null, stars = null, failed = false, ctl = null;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'gaia-ov');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', "Gaia DR3 position on this image's date");
  Object.assign(svg.style, { position: 'absolute', pointerEvents: 'none', overflow: 'visible', display: 'none', zIndex: 1 });
  cv.after(svg);
  const say = t => { if (note && note.textContent !== t) note.textContent = t; };
  say(NOTE_OFF);

  function load(v, k) {
    ctl?.abort(); ctl = new AbortController(); key = k; stars = null; failed = false;
    const mine = ctl;
    say('Asking Gaia DR3 for the stars in this patch…');
    fieldGaia({ grid: v.grid, preset: v.preset, base, signal: AbortSignal.any ? AbortSignal.any([mine.signal, AbortSignal.timeout(20000)]) : mine.signal })
      .then(rows => { if (key !== k || mine.signal.aborted) return; stars = rows; place(); })
      .catch(() => { if (key !== k || mine.signal.aborted) return; failed = true; say('Gaia DR3 did not answer, so there are no circles. Switch off and on to try again.'); place(); });
  }

  function place() {
    const v = view();
    if (!on || !v.show || !v.grid || !Number.isFinite(v.mjd)) { svg.style.display = 'none'; return; }
    const k = `${v.preset || ''}|${v.grid.ra0.toFixed(6)},${v.grid.dec0.toFixed(6)}`;
    if (k !== key) load(v, k);
    if (!stars) { svg.style.display = 'none'; return; }
    const marks = gaiaMarks(stars, v.grid, v.mjd), c = v.cell, W = v.grid.n * c, r = Math.max(5, 0.9 * c);
    Object.assign(svg.style, { left: cv.offsetLeft + 'px', top: cv.offsetTop + 'px', width: W + 'px', height: W + 'px', display: '' });
    svg.setAttribute('viewBox', `0 0 ${W} ${W}`);
    svg.setAttribute('aria-label', `Gaia DR3 position on this image's date: ${marks.length} star${marks.length === 1 ? '' : 's'}`);
    const pts = marks.map(m => `cx="${((m.x + 0.5) * c).toFixed(1)}" cy="${((m.y + 0.5) * c).toFixed(1)}" r="${r.toFixed(1)}"`);
    svg.innerHTML = `<g fill="none" stroke="rgba(0,0,0,.55)" stroke-width="3">${pts.map(p => `<circle ${p}/>`).join('')}</g>`
      + `<g fill="none" stroke="#8BE9FF" stroke-width="1.4">${pts.map(p => `<circle ${p}/>`).join('')}</g>`;
    svg.dataset.n = marks.length;
    say(marks.length ? `${marks.length} Gaia DR3 star${marks.length === 1 ? '' : 's'} circled, moved from 2016 to this image's date. Gaia sees visible light: many of them are too faint at these infrared wavelengths to show as a dot.` : 'No Gaia DR3 star bright enough in this patch.');
  }

  function set(v) {
    on = v; sw.setAttribute('aria-checked', String(on));
    if (!on) { svg.style.display = 'none'; svg.innerHTML = ''; say(NOTE_OFF); if (failed) key = null; return; }
    if (failed) key = null; // switched on again after a failure: ask again
    place();
  }
  sw.addEventListener('click', () => set(!on));
  return { place, set, get on() { return on; } };
}
