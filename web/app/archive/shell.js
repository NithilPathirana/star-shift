// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Shared shell for the Archive and Spectrum pages: nav links that keep the selected object,
// the search box, name/coordinate resolution, and small helpers. Browser only.

import { parseQuery, fromURL, formatRA, formatDec } from '../query.js';
import { resolveTarget } from '../data.js';
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
  form.addEventListener('submit', (e) => { e.preventDefault(); go(input.value); });
  for (const b of document.querySelectorAll('.pick')) b.addEventListener('click', () => { input.value = b.textContent; go(b.textContent); });
  window.addEventListener('popstate', () => { const q = currentQuery(); updateNav(q); onQuery(q); });
  const q = currentQuery();
  input.value = q.type === 'name' ? q.name : `${q.ra.toFixed(5)} ${q.dec >= 0 ? '+' : ''}${q.dec.toFixed(5)}`;
  updateNav(q);
  return q;
}

export async function resolve(q, signal) {
  return resolveTarget(q, { signal });
}

// Where to ask IRSA for the image list (moving stars: their place in late 2025, inside the survey).
export function listPosition(t) {
  return (t.pmra || t.pmdec) ? propagate(t, 61000) : { ra: t.ra, dec: t.dec };
}

export function targetLine(t) {
  const name = t.name || 'Unnamed patch';
  const pm = (t.pmra || t.pmdec) ? ` · moves ${Math.hypot(t.pmra, t.pmdec).toFixed(0)} mas/yr` : '';
  return { name, coords: `${formatRA(t.ra)}  ${formatDec(t.dec)}`, pm };
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
