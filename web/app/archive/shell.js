// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Shared shell for the Archive and Spectrum pages: nav links that keep the selected object,
// the search box, name/coordinate resolution, Clarity + Pages popovers and small helpers. Browser only.

import { parseQuery, fromURL, formatRA, formatDec } from '../query.js';
import { PRESETS, findPreset } from '../presets.js';
import { resolveName } from '../../core/resolve.js';
import { propagate } from '../../core/motion.js';

export const base = location.origin;

export function queryToParams(q) {
  const p = new URLSearchParams();
  if (q?.type === 'name') p.set('q', q.name);
  if (q?.type === 'coords') { p.set('ra', q.ra.toFixed(5)); p.set('dec', q.dec.toFixed(5)); }
  return p;
}

// Keep the selected object when moving between pages (DESIGN.md 25).
export function updateNav(q) {
  const s = queryToParams(q).toString();
  for (const a of document.querySelectorAll('a[data-page]')) {
    const extra = a.dataset.page === 'index.html' && s ? '&scene=viewer' : '';
    a.href = a.dataset.page + (s ? '?' + s + extra : '');
  }
  // "Tonight?" (rail key and Pages sheet) carries the object too, as it does from the Viewer.
  // AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
  for (const a of document.querySelectorAll('a[href^="planetarium.html"]')) a.href = 'planetarium.html' + (s ? '?' + s : '');
}

// The quick picks: the same five built-in targets, in the same order, as the Viewer (web/app/presets.js).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
function renderPicks() {
  const box = document.querySelector('.picks');
  if (!box) return;
  box.innerHTML = PRESETS.map(p => `<button class="key pick" type="button" title="${esc(p.note)}">${esc(p.label)}</button>`).join('');
}

export function currentQuery(fallback = "Barnard's Star") {
  const { query } = fromURL(location.search);
  return query ?? parseQuery(fallback);
}

// Wire the search form and the example picks. onQuery(query) runs for each new search.
export function initShell(onQuery) {
  const form = document.getElementById('searchForm'), input = document.getElementById('q'), err = document.getElementById('serr');
  const go = (text) => {
    err.hidden = true;
    let q;
    try { q = parseQuery(text); } catch (e) { err.textContent = e.message; err.hidden = false; return; }
    history.pushState(null, '', '?' + queryToParams(q));
    updateNav(q);
    onQuery(q);
  };
  initClarity(); initPops(); renderPicks();
  form.addEventListener('submit', (e) => { e.preventDefault(); go(input.value); });
  for (const b of document.querySelectorAll('.pick')) b.addEventListener('click', () => { input.value = b.textContent; go(b.textContent); });
  window.addEventListener('popstate', () => { const q = currentQuery(); updateNav(q); onQuery(q); });
  const q = currentQuery();
  input.value = q.type === 'name' ? q.name : `${q.ra.toFixed(5)} ${q.dec >= 0 ? '+' : ''}${q.dec.toFixed(5)}`;
  updateNav(q);
  return q;
}

// Copy of resolveTarget from web/app/data.js (kept here so these pages don't depend on a file
// other agents are editing): coordinates as typed, a built-in preset, or SIMBAD.
export async function resolve(q, signal) {
  if (q.type === 'coords') return { name: null, ra: q.ra, dec: q.dec, pmra: 0, pmdec: 0, epoch: 2000, source: 'coordinates' };
  const preset = findPreset(q.name);
  if (preset) return { ...preset.target, presetKey: preset.key };
  let t;
  try { t = await resolveName(q.name, { signal }); } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('The star-name service (SIMBAD) is not answering. Try again, or type coordinates instead.');
  }
  if (!t) { const err = new Error(`No star called "${q.name}" was found in SIMBAD. Check the spelling, or type coordinates.`); err.notFound = true; throw err; }
  return t;
}

// Copies of cutoutSizeDeg / cutoutCenter from web/app/data.js (same rounding, so the relay cache is shared).
export function cutoutSizeDeg(fovArcmin) {
  return +Math.min(0.5, (fovArcmin / 60) * Math.SQRT2 + (3 * 6.15) / 3600).toFixed(4);
}
export function cutoutCenter(target, mjd) {
  const p = (target.pmra || target.pmdec) ? propagate(target, mjd) : target;
  return { ra: +p.ra.toFixed(5), dec: +p.dec.toFixed(5) };
}

// Where to ask IRSA for the image list (moving stars: their place in late 2025, inside the survey).
export function listPosition(t) {
  return (t.pmra || t.pmdec) ? propagate(t, 61000) : { ra: t.ra, dec: t.dec };
}

// Header line. The catalogue position is labelled with its epoch; a moving star also gets
// "Position now" (propagated with its proper motion, as the Viewer shows it).
export function targetLine(t, now = new Date()) {
  const name = t.name || 'Unnamed patch';
  const label = t.source === 'coordinates' ? 'Typed position' : `Catalogue position, J${Number(t.epoch ?? 2000).toFixed(t.epoch % 1 ? 1 : 0)}`;
  const coords = `${label}: ${formatRA(t.ra)} ${formatDec(t.dec)}`;
  let pm = '';
  if (t.pmra || t.pmdec) {
    const p = propagate(t, now.getTime() / 86400000 + 40587);
    pm = ` · moves ${(Math.hypot(t.pmra, t.pmdec) / 1000).toFixed(2)}″/yr · Position now: ${formatRA(p.ra)} ${formatDec(p.dec)}`;
  }
  return { name, coords, pm };
}

// The motion part of the header: Expert = the measured line split at its separators (mono, like the
// catalogue position); Simple = plain words. A star under 0.05″/yr "barely moves" instead of "0.0″".
export function motionHtml(t, tl) {
  if (!tl.pm) return '';
  const x = tl.pm.split(' · ').filter(Boolean).map((p, i) => `${i ? '<span class="sp-sep x-only" aria-hidden="true">·</span>' : ''}<span class="num x-only">${esc(p)}</span>`).join('');
  const yr = Math.hypot(t.pmra, t.pmdec) / 1000;
  return x + `<span class="s-only">${yr < 0.05 ? 'barely moves (less than 0.1″ a year)' : `moves about ${yr.toFixed(1)}″ a year`}</span>`;
}

// ---- Clarity (same storage key and behaviour as the Viewer and Sky now) and popovers ----------
const CLARITY_KEY = 'tgi-clarity-v1';
const mq = (q) => matchMedia(q).matches;
export function initClarity() {
  const root = document.documentElement;
  let stored = {}; try { stored = JSON.parse(localStorage.getItem(CLARITY_KEY)) || {}; } catch { /* private mode */ }
  const set = Object.assign({ motion: mq('(prefers-reduced-motion: reduce)'), glass: mq('(prefers-reduced-transparency: reduce)'),
    contrast: mq('(prefers-contrast: more)'), text: false }, stored);
  const apply = () => {
    root.dataset.motion = set.motion ? 'reduce' : 'full'; root.dataset.glass = set.glass ? 'solid' : 'glass';
    root.dataset.contrast = set.contrast ? 'more' : 'normal'; root.dataset.text = set.text ? 'large' : 'normal';
    document.querySelectorAll('[data-set]').forEach(b => b.setAttribute('aria-checked', !!set[b.dataset.set]));
  };
  document.querySelectorAll('[data-set]').forEach(b => b.onclick = () => {
    set[b.dataset.set] = !set[b.dataset.set];
    try { const cur = JSON.parse(localStorage.getItem(CLARITY_KEY)) || {}; localStorage.setItem(CLARITY_KEY, JSON.stringify({ ...cur, [b.dataset.set]: set[b.dataset.set] })); } catch { /* private mode */ }
    apply();
  });
  apply();
}

let openPop = null;
export function showPop(pop, btn) {
  closePop(); const r = btn.getBoundingClientRect(); pop.hidden = false;
  pop.style.top = Math.min(r.bottom + 10, innerHeight - 160) + 'px';
  pop.style.right = Math.max(12, Math.min(innerWidth - r.right, innerWidth - pop.offsetWidth - 12)) + 'px'; pop.style.left = 'auto'; // stay on screen on phones
  requestAnimationFrame(() => pop.classList.add('open'));
  btn.setAttribute('aria-expanded', 'true'); openPop = { pop, btn };
  setTimeout(() => (pop.querySelector('button, a, input') || pop).focus(), 30);
}
export function closePop(refocus) {
  if (!openPop) return; const { pop, btn } = openPop; pop.classList.remove('open'); btn.setAttribute('aria-expanded', 'false');
  setTimeout(() => { if (!pop.classList.contains('open')) pop.hidden = true; }, 220); openPop = null; if (refocus) btn.focus();
}
function initPops() {
  const $ = (id) => document.getElementById(id);
  const toggler = (popId, btnId) => (e) => { e.stopPropagation(); openPop?.pop.id === popId ? closePop() : showPop($(popId), $(btnId)); };
  $('clarityBtn').onclick = toggler('clarity', 'clarityBtn');
  $('pagesBtn').onclick = toggler('pagesPop', 'pagesBtn');
  document.addEventListener('click', (e) => { if (openPop && !openPop.pop.contains(e.target)) closePop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openPop) closePop(true); });
}

export function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const slug = (s) => String(s || 'patch').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
