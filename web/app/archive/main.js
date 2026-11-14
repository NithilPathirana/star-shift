// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Observation Archive page: every SPHEREx image of a patch (IRSA image list), sortable and
// filterable, with real 25×25 thumbnails and flag counts loaded lazily for the visible page.

import { listImages, fetchCutout, maskBadPixels } from '../../core/irsa.js';
import { makeGrid, reproject } from '../../core/align.js';
import { wavelengthAt } from '../../core/wave.js';
import { propagate } from '../../core/motion.js';
import { DEFAULT_BANDS } from '../bands.js';
import { toRows, seasonsOf, sortRows, filterRows, paginate, rowsToCSV, summarizeFlags, targetViewerUrl, FLAG_KINDS, flagText, bandAt } from './logic.js';
import { base, initShell, resolve, listPosition, targetLine, download, slug, esc, cutoutSizeDeg, cutoutCenter } from './shell.js';

const $ = (id) => document.getElementById(id);
let tables = null;
const tablesReady = fetch('core/data/spectral_wcs.json').then(r => r.json()).then(t => { tables = t; }).catch(() => {});
const THUMB_N = 25, PIX = 6.15;
const SEL_KEY = 'starshift.archive.selected';
const S = {
  target: null, rows: [], seasons: [], view: [], sort: { key: 'n', dir: 'asc' }, page: 0, size: 50,
  filter: { season: 'all', band: 'all', detector: 'all', hasFlags: 'all', release: 'all', text: '' },
  open: new Set(), cache: new Map(), ctrl: null, pageCtrl: null,
  selected: (() => { try { return sessionStorage.getItem(SEL_KEY); } catch { return null; } })(),
};

// ---- loading ---------------------------------------------------------------------------------
async function load(q) {
  S.ctrl?.abort(); S.pageCtrl?.abort();
  const ctrl = S.ctrl = new AbortController();
  S.rows = []; S.view = []; S.page = 0; S.open.clear();
  $('count').textContent = 'Finding the star…'; $('rows').innerHTML = skeleton(8); $('empty').hidden = true;
  try {
    const t = await resolve(q, ctrl.signal);
    if (ctrl.signal.aborted) return;
    S.target = t;
    const tl = targetLine(t);
    $('tName').textContent = tl.name; $('tCoords').textContent = tl.coords; $('tPm').textContent = tl.pm;
    document.title = `${tl.name} · Observation Archive · Star Shift`;
    $('count').textContent = 'Asking IRSA for every SPHEREx image of this spot…';
    const p = listPosition(t);
    const ims = await listImages(p.ra, p.dec, { base, signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    S.rows = toRows(ims);
    S.seasons = seasonsOf(S.rows.map(r => r.mjd));
    buildFilters();
    apply();
  } catch (e) {
    if (e.name === 'AbortError') return;
    $('rows').innerHTML = '';
    $('count').textContent = '';
    showEmpty(e.notFound ? e.message : `Could not get the image list: ${e.message}. IRSA may be busy; try again in a minute.`, true);
  }
}

function skeleton(n) {
  return Array.from({ length: n }, () => '<tr class="skel"><td colspan="14"><i></i></td></tr>').join('');
}
function showEmpty(text, retry) {
  const el = $('empty');
  el.innerHTML = esc(text) + (retry ? ' <button class="key" id="retry">Try again</button>' : '');
  el.hidden = false;
  if (retry) $('retry').onclick = () => load(currentQ);
}

// ---- filters ---------------------------------------------------------------------------------
function chipRow(el, key, options) {
  el.innerHTML = options.map(o => `<button class="key chip-k" type="button" data-v="${esc(o.v)}" aria-pressed="${String(S.filter[key]) === String(o.v)}"${o.title ? ` title="${esc(o.title)}"` : ''}>${o.html}</button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.filter[key] = b.dataset.v;
    S.page = 0; apply();
  };
}

function buildFilters() {
  for (const k of ['season', 'band', 'detector', 'hasFlags', 'release']) S.filter[k] = 'all';
  const n = (pred) => S.rows.filter(pred).length;
  chipRow($('fSeason'), 'season', [{ v: 'all', html: 'All' }, ...S.seasons.map(s => ({ v: s.i, html: `${esc(s.label)} <span class="num dim">${s.n}</span>` }))]);
  chipRow($('fBand'), 'band', [{ v: 'all', html: 'All' }, ...DEFAULT_BANDS.map(b => ({ v: b.id, title: `${b.min}–${b.max} µm. ${b.tip}`, html: `<i class="sw" style="background:${b.color}"></i>${esc(b.name)}` }))]);
  const dets = [...new Set(S.rows.map(r => r.detector))].sort();
  chipRow($('fDet'), 'detector', [{ v: 'all', html: 'All' }, ...dets.map(d => ({ v: d, html: `D${d} <span class="num dim">${n(r => r.detector === d)}</span>` }))]);
  chipRow($('fFlags'), 'hasFlags', [{ v: 'all', html: 'All' }, { v: 'yes', html: 'Has flags' }, { v: 'no', html: 'Clean' }, { v: 'unchecked', html: 'Not loaded' }]);
  const rels = [...new Set(S.rows.map(r => r.release))].sort();
  chipRow($('fRel'), 'release', [{ v: 'all', html: 'All' }, ...rels.map(r => ({ v: r, html: `${r.toUpperCase()} <span class="num dim">${n(x => x.release === r)}</span>` }))]);
}

// ---- table -----------------------------------------------------------------------------------
const FILTER_EL = { season: 'fSeason', band: 'fBand', detector: 'fDet', hasFlags: 'fFlags', release: 'fRel' };
const FILTER_NAME = { season: 'Season', band: 'Band', detector: 'Detector', hasFlags: 'Flags', release: 'Release' };
function apply() {
  S.view = sortRows(filterRows(S.rows, S.filter), S.sort.key, S.sort.dir);
  for (const [k, id] of Object.entries(FILTER_EL)) for (const x of $(id).children) x.setAttribute('aria-pressed', String(x.dataset.v === String(S.filter[k])));
  renderActive();
  render();
}

// Active filters as removable chips (shown beside the Filters key on phones).
function renderActive() {
  const on = Object.keys(FILTER_EL).filter(k => S.filter[k] !== 'all').map(k => {
    const label = $(FILTER_EL[k]).querySelector(`[data-v="${CSS.escape(String(S.filter[k]))}"]`)?.textContent.replace(/\s+\d+$/, '').trim() ?? S.filter[k];
    return `<button class="key chip-k" type="button" data-k="${k}" aria-label="Remove filter ${FILTER_NAME[k]}: ${esc(label)}">${FILTER_NAME[k]}: ${esc(label)} <span aria-hidden="true">×</span></button>`;
  });
  if (S.filter.text) on.push(`<button class="key chip-k" type="button" data-k="text" aria-label="Remove text filter">“${esc(S.filter.text)}” <span aria-hidden="true">×</span></button>`);
  $('active').innerHTML = on.join('');
  $('filtersBtn').textContent = on.length ? `Filters (${on.length})` : 'Filters';
}
$('active').onclick = (e) => {
  const b = e.target.closest('button[data-k]'); if (!b) return;
  if (b.dataset.k === 'text') { S.filter.text = ''; $('fText').value = ''; } else S.filter[b.dataset.k] = 'all';
  S.page = 0; apply();
};
function sheet(open) {
  $('filters').classList.toggle('open', open); $('filtersBtn').setAttribute('aria-expanded', String(open));
  $('scrim').hidden = !open;
  if (open) $('filtersDone').focus(); else $('filtersBtn').focus();
}
$('filtersBtn').onclick = () => sheet(true);
$('filtersDone').onclick = () => sheet(false);
$('scrim').onclick = () => sheet(false);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('filters').classList.contains('open')) sheet(false); });

function render() {
  const pg = paginate(S.view, S.page, S.size);
  S.page = pg.page;
  const all = S.rows.length;
  $('count').textContent = all ? `${S.view.length.toLocaleString()} of ${all.toLocaleString()} images${pg.total ? ` · showing ${pg.from}–${pg.to}` : ''}` : '';
  $('pageTxt').textContent = `${pg.page + 1} / ${pg.pages}`;
  $('prev').disabled = pg.page === 0; $('next').disabled = pg.page >= pg.pages - 1;
  for (const th of document.querySelectorAll('th[data-sort]')) {
    const on = th.dataset.sort === S.sort.key;
    th.setAttribute('aria-sort', on ? (S.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  }
  if (!all) showEmpty('The archive has no images of this patch yet.');
  else if (!pg.total) showEmpty('No images match these filters.');
  else $('empty').hidden = true;
  $('rows').innerHTML = pg.rows.map(rowHtml).join('');
  for (const r of pg.rows) if (S.cache.has(r.uri)) paintThumb(r);
  const wl = S.rows.length ? [Math.min(...S.rows.map(r => r.wlMin)), Math.max(...S.rows.map(r => r.wlMax))] : null;
  $('foot').textContent = all ? `${all.toLocaleString()} images · ${S.seasons.length} season${S.seasons.length === 1 ? '' : 's'} · ${wl[0].toFixed(2)}–${wl[1].toFixed(2)} µm · Images: NASA SPHEREx via IRSA` : '';
  loadPage(pg.rows);
}

const STATUS = { waiting: 'Waiting', loading: 'Loading', loaded: 'Loaded', failed: 'Failed' };
function rowHtml(r) {
  const open = S.open.has(r.uri), sel = S.selected === r.uri;
  const s = S.seasons[r.season];
  const fl = r.flags
    ? `<span class="num" title="${esc(flagText(r.flags))}">${r.flags.flagged}<span class="dim"> / ${r.flags.total}</span></span>`
    : `<span class="dim" title="${r.status === 'failed' ? 'The cutout could not be downloaded' : 'Loads when the row is on screen'}">—</span>`;
  const st = r.status === 'failed' ? `<button class="linkbtn" data-act="retry">Failed · Retry</button>` : `<span class="st st-${r.status}">${STATUS[r.status]}</span>`;
  const main = `<tr class="arow${sel ? ' sel' : ''}" data-uri="${esc(r.uri)}" tabindex="0" title="Open this image in the viewer">
    <td class="c-x"><button class="key xbtn" data-act="expand" aria-expanded="${open}" aria-label="Details for image ${r.n}">${open ? '▾' : '▸'}</button></td>
    <td class="c-th"><canvas class="athumb${r.status === 'loaded' ? '' : ' empty'}" width="50" height="50" aria-label="Image ${r.n} thumbnail"></canvas></td>
    <td class="r num">${r.n}</td>
    <td class="num">${r.date}</td>
    <td class="num">${r.time}</td>
    <td>${s ? esc(s.label) : '—'}</td>
    <td class="r num">D${r.detector}</td>
    <td>${wlCell(r)}</td>
    <td class="r num">${r.mjd.toFixed(4)}</td>
    <td class="num">${esc(r.obsid)}</td>
    <td>${r.release.toUpperCase()}</td>
    <td class="r">${fl}</td>
    <td>${st}</td>
    <td class="links"><a href="${esc(r.irsaUrl)}" target="_blank" rel="noopener" title="${esc(r.irsaUrl)}">FITS ↗</a><a href="${esc(targetViewerUrl(S.target, r.mjd))}" title="Play in Star Shift">Play</a></td>
  </tr>`;
  return open ? main + detailHtml(r) : main;
}

// Before the image loads: the detector's range. After: the wavelength at the star's pixel (as the viewer shows it).
function wlCell(r) {
  if (Number.isFinite(r.wlStar)) {
    const b = bandAt(r.wlStar);
    return `<span class="wl" title="Wavelength at the star's pixel (detector D${r.detector} covers ${r.wlMin?.toFixed(2)}–${r.wlMax?.toFixed(2)} µm)"><i class="sw" style="background:${b?.color ?? 'transparent'}"></i><span class="num">λ ${r.wlStar.toFixed(3)} µm</span> <span class="dim">${esc(b?.name ?? '')}</span></span>`;
  }
  return `<span class="wl" title="Detector range; the wavelength at the star shows once the image loads"><i class="sw" style="background:${r.bandColor ?? 'transparent'}"></i><span class="num">${r.wlMin?.toFixed(2) ?? '—'}–${r.wlMax?.toFixed(2) ?? '—'} µm</span> <span class="dim">${esc(r.band ?? '')}</span></span>`;
}

function detailHtml(r) {
  const f = r.flags;
  const kinds = f ? FLAG_KINDS.map(k => `<li><b>${k.label}</b> <span class="num">${f[k.id]}</span> px</li>`).join('') : '';
  const names = f ? Object.entries(f.byName).sort((a, b) => b[1] - a[1]).map(([n, c]) => `<span class="num nm">${esc(n)} ${c}</span>`).join(' ') : '';
  return `<tr class="drow"><td></td><td colspan="13"><div class="detail">
    <div><h3>Flagged pixels <span class="tag obs">OBSERVED</span></h3>
      ${f ? `<p class="num">${f.flagged} of ${f.total} pixels in the 25×25 patch carry a problem flag (a pixel can have several).</p><ul class="kinds">${kinds}</ul><p class="names">${names || '<span class="dim">No flag bits set.</span>'}</p>`
    : r.status === 'failed' ? '<p>— The cutout could not be downloaded. <button class="linkbtn" data-act="retry">Retry</button></p>' : '<p class="dim">— Loading the cutout…</p>'}</div>
    <div><h3>File</h3><p class="num url">${esc(r.irsaUrl)}</p>
      <p class="num dim">MJD ${r.mjd.toFixed(6)} – ${r.mjdEnd?.toFixed(6) ?? '—'} · ${esc(r.iso)}</p>
      <p><button class="key" data-act="flags">Check flags</button> <a class="key" href="${esc(targetViewerUrl(S.target, r.mjd))}">Play in Star Shift</a></p></div>
  </div></td></tr>`;
}

// ---- thumbnails + flags (lazy, visible page only) ------------------------------------------------
async function loadOne(r, signal) {
  if (S.cache.has(r.uri)) return S.cache.get(r.uri);
  const c0 = cutoutCenter(S.target, r.mjd);
  const raw = await fetchCutout(r.uri, c0.ra, c0.dec, cutoutSizeDeg(THUMB_N * PIX / 60), { base, signal });
  const grid = makeGrid(c0.ra, c0.dec, THUMB_N * PIX, PIX);
  const f = reproject(maskBadPixels(raw), grid); // masked pixels -> NaN; flag words carried for every pixel
  await tablesReady;
  const pos = (S.target.pmra || S.target.pmdec) ? propagate(S.target, raw.mjd) : S.target;
  const [px, py] = raw.wcs.worldToPix(pos.ra, pos.dec);
  const tab = tables?.[String(raw.detector)];
  const wl = tab ? wavelengthAt(raw.header, tab, px, py).wavelength : null;
  const out = { n: f.n, d: Array.from(f.data, v => (Number.isFinite(v) ? v : null)), flags: raw.flags ? f.flags : null, flagNames: raw.flagNames, wl: Number.isFinite(wl) ? wl : null };
  out.summary = out.flags ? summarizeFlags(out.flags, out.flagNames) : null;
  S.cache.set(r.uri, out);
  return out;
}

async function loadPage(rows) {
  S.pageCtrl?.abort();
  const ctrl = S.pageCtrl = new AbortController();
  const todo = rows.filter(r => !S.cache.has(r.uri) && r.status !== 'failed');
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !ctrl.signal.aborted) {
      const r = todo[next++];
      await fetchRow(r, ctrl.signal);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, todo.length) }, worker));
}

async function fetchRow(r, signal) {
  setStatus(r, 'loading');
  try {
    const c = await loadOne(r, signal);
    r.flags = c.summary; r.wlStar = c.wl; setStatus(r, 'loaded');
  } catch (e) {
    if (e.name === 'AbortError' || signal?.aborted) { setStatus(r, 'waiting'); return; }
    setStatus(r, 'failed');
  }
}

function rowEl(r) { return $('rows').querySelector(`tr[data-uri="${CSS.escape(r.uri)}"]`); }
function setStatus(r, st) {
  r.status = st;
  const el = rowEl(r);
  if (!el) return;
  const open = S.open.has(r.uri);
  const tmp = document.createElement('tbody');
  tmp.innerHTML = rowHtml(r);
  const next = el.nextElementSibling?.classList.contains('drow') ? el.nextElementSibling : null;
  next?.remove();
  el.replaceWith(...tmp.children);
  if (st === 'loaded' || (open && S.cache.has(r.uri))) paintThumb(r);
}

function paintThumb(r) {
  const c = S.cache.get(r.uri), cv = rowEl(r)?.querySelector('canvas');
  if (!c || !cv || !window.MockRender) return;
  const styles = getComputedStyle(document.documentElement);
  window.MockRender.draw(cv, { d: c.d, exp: [0, 0] }, c.n, { ramp: 'copper', cell: 2, hatch: false, maskBg: styles.getPropertyValue('--mask-bg').trim() || '#211b16' });
  cv.classList.remove('empty');
}

// ---- events ---------------------------------------------------------------------------------
$('rows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr.arow, tr.drow');
  if (!tr) return;
  const rowTr = tr.classList.contains('drow') ? tr.previousElementSibling : tr;
  const r = S.rows.find(x => x.uri === rowTr.dataset.uri);
  if (!r) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (e.target.closest('a')) { select(r); return; }
  if (act === 'expand') { S.open.has(r.uri) ? S.open.delete(r.uri) : S.open.add(r.uri); setStatus(r, r.status); return; }
  if (act === 'retry' || act === 'flags') { r.status = 'waiting'; S.cache.delete(r.uri); fetchRow(r); return; }
  if (tr.classList.contains('drow')) return;
  select(r);
  location.href = targetViewerUrl(S.target, r.mjd);
});
$('rows').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('tr.arow')) e.target.click();
});
function select(r) {
  S.selected = r.uri;
  try { sessionStorage.setItem(SEL_KEY, r.uri); } catch { /* private mode */ }
}

for (const th of document.querySelectorAll('th[data-sort]')) {
  th.tabIndex = 0;
  const go = () => {
    const k = th.dataset.sort;
    S.sort = { key: k, dir: S.sort.key === k && S.sort.dir === 'asc' ? 'desc' : 'asc' };
    apply();
  };
  th.addEventListener('click', go);
  th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
}
$('prev').onclick = () => { S.page--; render(); };
$('next').onclick = () => { S.page++; render(); };
$('pageSize').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('pageSize').children) x.setAttribute('aria-pressed', String(x === b));
  S.size = Number(b.dataset.v); S.page = 0; render();
};
let tTimer;
$('fText').oninput = (e) => { clearTimeout(tTimer); tTimer = setTimeout(() => { S.filter.text = e.target.value; S.page = 0; apply(); }, 150); };
$('csv').onclick = () => {
  if (!S.view.length) return;
  download(`star-shift-archive-${slug(S.target?.name || `${S.target?.ra?.toFixed(3)}_${S.target?.dec?.toFixed(3)}`)}.csv`, rowsToCSV(S.view, S.seasons));
};

let currentQ = initShell((q) => { currentQ = q; load(q); });
load(currentQ);
