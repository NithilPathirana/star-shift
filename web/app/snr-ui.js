// Signal-to-noise tool in the pages (spec A): the viewer's side panel ("This spot: signal-to-noise")
// and Spot's verdict card. The maths is in ./snr.js (pure, tested); this file fetches the native
// cutout of the image on screen (the same URL the viewer loaded, so it comes from web/prebaked/ or
// the relay's cache) and, when the archive answers, its VARIANCE layer.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { fetchCutout, fetchCutoutLayers } from '../core/irsa.js';
import { aperturePhotometry, detectorCounts, snrText, csvRow, CSV_HEAD, SNR_DEFAULT_R, PIXEL_ARCSEC } from './snr.js';

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cutCache = new Map();   // uri|centre -> Promise<cutout>
const varCache = new Map();   // same key -> Promise<variance image | null>
const keyOf = (f) => `${f.uri}|${f.cut.ra}|${f.cut.dec}|${f.cut.size}`;
function remember(map, k, make) {
  if (!map.has(k)) { if (map.size > 60) map.delete(map.keys().next().value); const p = make(); map.set(k, p); p.catch(() => map.delete(k)); }
  return map.get(k);
}
const nativeCutout = (f, base) => remember(cutCache, keyOf(f), () => fetchCutout(f.uri, f.cut.ra, f.cut.dec, f.cut.size, { base, retries: 1 }));
// VARIANCE comes from the archive itself (it is not in the pre-baked files): one try, 10 s; a miss is remembered (null).
const varianceOf = (f, base) => remember(varCache, keyOf(f), () => {
  const p = fetchCutoutLayers(f.uri, f.cut.ra, f.cut.dec, f.cut.size, { base, retries: 0, signal: AbortSignal.timeout(10000) })
    .then(c => c.variance || null).catch(() => null);
  p.then(() => { p.settled = true; }); // so the line stops saying "asking the archive…"
  return p;
});

/**
 * Photometry at (ra, dec) on one loaded frame (data.js loadFrame: uri, cut, detector, mjd, obsid).
 * onResult(res) is called with the sky-scatter result first, then again once VARIANCE is in (if it comes).
 * res = { p, meta } — p from snr.js aperturePhotometry.
 */
export async function measureFrame(f, ra, dec, { r = SNR_DEFAULT_R, base, onResult, isCurrent = () => true } = {}) {
  if (!f?.uri || !f.cut) return null;
  const c = await nativeCutout(f, base);
  if (!isCurrent()) return null;
  const [x, y] = c.wcs.worldToPix(ra, dec);
  const meta = { obsid: f.obsid, mjd: f.mjd, detector: f.detector, wavelengthUm: f.wavelengthUm, ra, dec };
  const run = (variance) => ({ p: aperturePhotometry(c.image, x, y, { r, variance, flags: c.flags, flagNames: c.flagNames }), meta });
  const first = run(null);
  onResult?.(first);
  if (!first.p.ok) return first; // saturated / blanked / edge: VARIANCE would not change that
  const v = await varianceOf(f, base);
  if (!isCurrent()) return null;
  if (!v || v.nx !== c.image.nx || v.ny !== c.image.ny) { onResult?.(first); return first; } // again: now "VARIANCE could not be loaded"
  const second = run(v);
  onResult?.(second);
  return second;
}

const SIMPLE_WHY = 'It compares the light in a small circle here with the random flicker of the sky around it; above about 5 the spot is clearly real, and adding more images of the same spot raises it.';

// HTML for one result (both modes; expert.js shows one). opts: { counts, name, csv: true for the Copy key, pending }
export function snrHTML(res, { counts = {}, name = '', when = '', csv = true, pending = false } = {}) {
  const { p, meta } = res, t = snrText(p, counts, { detector: meta.detector });
  const src = p.ok ? (p.noiseFrom === 'variance+sky' ? 'noise from the VARIANCE layer and the sky scatter' : pending ? 'sky scatter only for now; asking the archive for the VARIANCE layer…' : 'sky scatter only (the VARIANCE layer could not be loaded), so a bright star\'s SNR is too high') : '';
  const row = csvRow(p, { ...meta, target: name }, counts);
  return `<p class="snr-line" data-snr="${p.ok ? p.snr.toFixed(2) : esc(p.reason)}"><b>${esc(t.line)}</b>${p.ok ? `<span class="s-only"> ${esc(t.simple.slice(t.line.length).trim())}</span>` : ''}</p>
    ${p.ok ? `<p class="snr-why s-only">${esc(SIMPLE_WHY)}</p>` : ''}
    <div class="snr-x x-only">
      ${p.ok ? `<p class="snr-st">${esc(t.simple.slice(t.line.length).trim())}</p>` : ''}
      <ul class="snr-f num">${t.expert.slice(p.ok ? 0 : 1).map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <p class="snr-m">${esc(`${when ? when + ' · ' : ''}detector ${meta.detector}${meta.wavelengthUm ? `, λ ${meta.wavelengthUm.toFixed(2)} µm` : ''} · obs ${meta.obsid || '—'}${src ? ' · ' + src : ''}`)}</p>
      ${csv ? `<button type="button" class="key snr-csv" data-csv="${esc(row)}" title="${esc(CSV_HEAD)}">Copy CSV row</button>` : ''}
    </div>
    ${p.ok && p.noiseFrom === 'sky' && !pending ? '<p class="snr-n s-only">Sky noise only (the archive\'s VARIANCE layer did not load), so for a bright star this is too high.</p>' : ''}`;
}

// Copy CSV row (header + row), delegated so re-rendered keys keep working.
document.addEventListener('click', async (e) => {
  const b = e.target.closest?.('.snr-csv'); if (!b) return;
  const text = `${CSV_HEAD}\n${b.dataset.csv}`;
  try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; }
  catch { b.textContent = 'Copy blocked'; }
  setTimeout(() => { b.textContent = 'Copy CSV row'; }, 1500);
});

/**
 * Viewer panel. el: the section body. Callbacks give the page's state:
 *   frame()        the image on screen (data.js frame) or null
 *   frames()       every kept frame (for the per-detector counts)
 *   seasonOf(mjd)  season index (seasons.js seasonAt with the page's bounds)
 *   starAt(frame)  [ra, dec] of the target's predicted place on that image, or null
 *   name()         target name, for the CSV
 */
export function createSnrPanel(el, { frame, frames, seasonOf, starAt, name, base }) {
  let spot = null, spotFor = '', r = SNR_DEFAULT_R, token = 0, timer = 0;
  const radiusKeys = () => `<div class="snr-r" role="group" aria-label="Measuring circle radius"><span>Circle</span>${[1, 2, 3, 4].map(k =>
    `<button type="button" class="key snr-rk" data-r="${k}" aria-pressed="${k === r}" title="${k} pixel${k > 1 ? 's' : ''} = ${(k * PIXEL_ARCSEC).toFixed(1)}″ radius">${k} px</button>`).join('')}</div>`;
  const where = () => (spot ? 'the spot you clicked' : 'the star\'s predicted place');
  function paint(html, f) {
    const day = f?.date ? new Date(String(f.date).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
    const on = day ? ` on the ${day} image` : '';
    el.innerHTML = `<p class="snr-at">${esc(spot ? `At the spot you clicked${on}` : `At the star's predicted place${on} (click the image to measure any spot)`)}</p>${html}${radiusKeys()}${spot ? '<button type="button" class="fl-link snr-back">Back to the star</button>' : ''}`;
  }
  el.addEventListener('click', (e) => {
    const k = e.target.closest('.snr-rk'); if (k) { r = +k.dataset.r; update(true); return; }
    if (e.target.closest('.snr-back')) { spot = null; update(true); }
  });
  function update(now) {
    clearTimeout(timer);
    timer = setTimeout(go, now ? 0 : 350); // playback flips images fast: measure once it settles
  }
  async function go() {
    const f = frame(), my = ++token;
    if (spot && spotFor !== name()) spot = null; // a new target: back to its star
    if (!f) { paint('<p class="muted">Load a target to measure its signal-to-noise.</p>'); return; }
    const pos = spot || starAt(f);
    if (!pos) { paint('<p class="muted">Click a spot on the image to measure its signal-to-noise.</p>'); return; }
    const counts = detectorCounts(frames(), f, seasonOf);
    if (!el.querySelector('.snr-line')) paint('<p class="muted">Measuring…</p>', f);
    const when = f.date ? `${String(f.date).slice(0, 10)}` : '';
    try {
      await measureFrame(f, pos[0], pos[1], { r, base, isCurrent: () => my === token,
        onResult: (res) => { if (my === token) paint(snrHTML(res, { counts, name: name(), when, pending: res.p.ok && res.p.noiseFrom === 'sky' && !varDone(f) }), f); } });
    } catch (e) {
      if (my === token) paint(`<p class="muted">Could not load this image's pixels to measure (${esc(e.message || e)}). Try another image.</p>`, f);
    }
  }
  const varDone = (f) => varCache.has(keyOf(f)) && varCache.get(keyOf(f)).settled;
  return {
    update,
    at(ra, dec) { spot = [ra, dec]; spotFor = name(); update(true); },
    reset() { spot = null; update(true); },
    where,
  };
}

/**
 * Spot's verdict card: one SNR line for the suspect's dot, on the middle image of the season it was
 * found in. stack: the season stack ({ frames }), allFrames: every loaded frame. Resolves to HTML.
 */
export async function spotSnrHTML(stack, img, allFrames, ra, dec, { base, label = '' } = {}) {
  let last = null;
  await measureFrame(img, ra, dec, { base, onResult: (res) => { last = res; } });
  if (!last) return '';
  const same = (f) => f.detector === img.detector;
  const counts = { nSeason: stack.frames.filter(same).length, nAll: allFrames.filter(same).length };
  return snrHTML(last, { counts, when: label, csv: true });
}
