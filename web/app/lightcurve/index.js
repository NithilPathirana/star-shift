// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Brightness-vs-date strip in the viewer's info panel (DESIGN.md 25 charts: dark plate, Plex
// Mono 11 px axes, band colours as data colours only, selected point filled, others hollow).
// One row per wavelength group, never averaged together; a copper playhead at the image on the
// stage; click or tap a point to jump to that image; arrow keys step between plotted images.
// The numbers come from logic.js (same method as the Proof page).

import { measure, lightcurve, message, skippedText, fmtMag, CAPTION, lightOnSky, pickSource, pickSaved, notHereText, saturatedNote, BLEND_RADIUS, AP_ARCSEC } from './logic.js';
import { gaiaCone } from '../../core/resolve.js';
import { seasonBounds, groupInto, seasonMonths } from '../seasons.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mjdDate = (m) => new Date((m - 40587) * 864e5);
const fmtDay = (m) => { const d = mjdDate(m); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
// 'Sep 25', 'Feb–Mar 26', 'Dec 25–Jan 26': the season's months as the viewer names them (seasons.js), short years
const seasonLbl = (s) => seasonMonths(s).replace(/ (\d\d)(\d\d)/g, ' $2');
const SHAPE = { short: 'circle', long: 'square' };
const emptyWhy = (g) => (!g.total ? 'no images at these wavelengths'
  : g.absent ? 'not detected here'
  : g.masked === g.total ? `a masked pixel within ${AP_ARCSEC}″ in every image`
  : g.masked ? `a masked pixel within ${AP_ARCSEC}″ in ${g.masked} of ${g.total} images` : 'no first-season match');
// inside the plot (one SVG line, it cannot wrap): the short form; the full sentence is the line's tooltip and the text under the chart
const plotWhy = (g) => (g.total && !g.absent && g.masked ? (g.masked === g.total ? 'masked in every image' : `masked in ${g.masked} of ${g.total} images`) : emptyWhy(g));
const WHERE = { short: 'below 3.8 µm', long: 'at 3.8–5.0 µm' }; // the group's range, for "WISE 0855 is too faint below 3.8 µm"
const fmtJy = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

// Expert only: where the measured light centre sits (WISE 0855: 8.1″), beside the catalogue separation of the star named
export const lightCentre = (g, name, esc) => (g.detect?.state === 'offset' && g.sky
  ? `<span class="x-only"> · light centre ${g.sky.offArcsec.toFixed(1)}″ from ${esc(name)}'s position</span>` : '');

export function createLightcurve({ $, esc, colourOf = () => '#B5A898', onPick, onSource = () => {} }) {
  const plot = $('lcPlot'), read = $('lcRead'), sum = $('lcSum'), cap = $('lcCap');
  const S = { lc: null, frames: [], rows: [], cur: -1, hover: null, key: '', name: '', geo: null };
  if (cap) cap.textContent = `${CAPTION} Each dot is one image (colour = its wavelength band), compared with first-season images from the same detector at the same wavelength (Δ mag, brighter up); white lines are season averages. Seasons sit side by side: the months between them are left out. Flux in mJy uses each image's own 6.15″ pixel size.`;

  // frames: the viewer's raw frames in player order (V.F[i].raw), or null while loading.
  // bounds: the viewer's seasons (seasons.js), so the axis and the season averages use the same seasons.
  function data(frames, grid, name, loading, bounds) {
    S.name = name || 'This object';
    if (!frames || loading) { S.lc = null; S.frames = []; S.key = ''; render(loading ? 'Measuring when all images are in…' : null); return; }
    S.bounds = bounds?.length ? bounds : seasonBounds(frames.map(f => f.mjd));
    const key = frames.length + ':' + frames.map(f => f.mjd).join(',') + '|' + S.bounds.map(b => b.startMjd).join(',');
    if (key === S.key) return;
    S.key = key; S.frames = frames; S.rows = measure(frames, grid);
    S.lc = lightcurve(S.rows, S.bounds);
    for (const g of S.lc.groups) if (g.absent) {
      g.sky = lightOnSky(g.detect, grid);
      // a saved Gaia neighbour (proof.json) is named at once, so the first text is the one the maker and SNR use
      if (g.detect?.state === 'offset' && SAVED) g.src = pickSaved(nbOf(SAVED, S.name), g.sky);
    }
    render();
    explain(key);
  }

  // a3: a group whose light is centred on another source: ask Gaia (through our relay) what is
  // there, and name it. Without an answer the row still says "Not detected here".
  const gaiaCache = new Map();
  async function explain(key) {
    for (const g of S.lc?.groups || []) {
      if (!g.absent || g.detect?.state !== 'offset' || !g.sky) continue;
      const [ra, dec] = g.sky.light, ck = `${ra.toFixed(5)},${dec.toFixed(5)}`;
      // the saved neighbour list first (demo targets, proof.json: no network, no 15 s wait when Gaia is slow), then live Gaia
      let src = pickSaved(await savedNeighbours(S.name), g.sky);
      if (src && S.key === key) { g.src = src; render(); onSource(); continue; }
      try {
        if (!gaiaCache.has(ck)) gaiaCache.set(ck, gaiaCone(ra, dec, BLEND_RADIUS, { endpoint: `${location.origin}/gaia/tap/sync`, top: 10, signal: AbortSignal.timeout(15000) }));
        src = pickSource(await gaiaCache.get(ck), g.sky);
      } catch { gaiaCache.delete(ck); src = pickSaved(await savedNeighbours(S.name), g.sky); }
      if (S.key !== key) return; // another target since
      if (src) { g.src = src; render(); onSource(); }
    }
  }
  // proof.json, fetched once at start (the demo targets' saved Gaia neighbours); SAVED once it has arrived
  let SAVED = null;
  const proofP = fetch(new URL('../../data/proof.json', import.meta.url)).then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(d => { SAVED = d; return d; });
  const nbOf = (d, name) => d?.targets?.find(q => q.name === name || q.label === name)?.extra?.neighbours || [];
  async function savedNeighbours(name) { return nbOf(await proofP, name); }

  function mark(i) { S.cur = i; paint(); }

  function render(waitText) {
    const lc = S.lc;
    plot.hidden = false; if (cap) cap.hidden = false;
    if (!lc) { plot.innerHTML = waitText ? `<p class="lc-msg">${esc(waitText)}</p>` : ''; read.textContent = ''; sum.innerHTML = ''; S.geo = null; return; }
    const msg = message(lc, S.name);
    const sat = saturatedNote(lc, S.name);
    if (sat) { // a9: one sentence and where to go instead, no empty chart (and no caption about its dots)
      plot.innerHTML = ''; plot.hidden = true; if (cap) cap.hidden = true; read.textContent = ''; S.geo = null;
      sum.innerHTML = `<p class="lc-row lc-sat" style="display:block;margin:0;line-height:1.45">${esc(sat.text)} ${sat.links.map(l => `<a href="${esc(l.href)}">${esc(l.text)}</a>`).join(' · ')}</p>`;
      return;
    }
    if (lc.status !== 'ok') {
      plot.innerHTML = `<p class="lc-msg">${esc(msg)}</p>`;
      read.textContent = ''; S.geo = null;
      sum.innerHTML = `<p class="lc-skip num">${esc(skippedText(lc))}</p>`;
      return;
    }
    sum.innerHTML = lc.groups.map(g => {
      const v = g.ok ? `<b>${fmtMag(g.dmag)} ± ${g.dmagErr.toFixed(2)} mag</b> ${g.dmag > 0 ? 'fainter' : 'brighter'}${g.sigma != null ? `<span class="x-only"> · ${g.sigma}σ</span>` : ''}` : g.points.length ? 'too few images to compare seasons'
        : g.absent ? esc(notHereText(g.detect, g.sky, g.src, S.name, WHERE[g.id])) + lightCentre(g, S.name, esc) : emptyWhy(g);
      return `<div class="lc-row"><span class="lc-k"><i class="lc-mk lc-${SHAPE[g.id]}" aria-hidden="true"></i>${esc(g.name)}</span><span class="lc-v num">${v}${g.points.length ? `<small>${g.ok ? 'last season vs first · ' : ''}${g.points.length} image${g.points.length === 1 ? '' : 's'}</small>` : ''}</span></div>`;
    }).join('') + `<p class="lc-skip num">${esc(skippedText(lc))}</p>`;
    draw();
  }

  // ---- the chart (sized to its box so text stays at 11 px) ----
  function draw() {
    const lc = S.lc; if (!lc || lc.status !== 'ok') return;
    const W = Math.max(220, Math.round(plot.clientWidth || 280));
    const L = 40, Rr = 8, head = 16, rowH = 58, gap = 10, top = 4, rows = lc.groups;
    const H = top + rows.length * (head + rowH) + (rows.length - 1) * gap + 20;
    // Seasons side by side, each with its own time scale (SPHEREx images come in bursts of a few
    // weeks every ~6 months; one shared axis would squash each burst to a line). The months
    // between seasons are left out, and the caption says so.
    // one panel per season that has images here, the seasons the viewer names (seasons.js)
    const seasons = groupInto(S.frames, S.bounds).map(s => ({ from: s.frames[0].mjd, to: s.frames[s.frames.length - 1].mjd, startMjd: s.startMjd, endMjd: s.endMjd }));
    const sg = 8, pw = (W - L - Rr - sg * (seasons.length - 1)) / seasons.length;
    seasons.forEach((s, k) => { const pad = Math.max(1.5, (s.to - s.from) * 0.08); s.t0 = s.from - pad; s.t1 = s.to + pad; s.x0 = L + k * (pw + sg); });
    const X = m => {
      let s = seasons.find(q => m >= q.t0 && m <= q.t1);
      if (!s) s = seasons.reduce((a, q) => (Math.min(Math.abs(m - q.from), Math.abs(m - q.to)) < Math.min(Math.abs(m - a.from), Math.abs(m - a.to)) ? q : a));
      return s.x0 + Math.min(1, Math.max(0, (m - s.t0) / (s.t1 - s.t0))) * pw;
    };
    const geo = { W, H, X, rows: [] };
    // axis-break mark: two short parallel slashes centred on (cx, cy), fitting the 8 px gap
    const brk = (cx, cy) => [-2, 2].map(d => `<line x1="${cx + d - 1.8}" y1="${cy + 4}" x2="${cx + d + 1.8}" y2="${cy - 4}" class="lc-brk" style="stroke:var(--stage-muted);stroke-width:1.2;stroke-linecap:round"/>`).join('');
    let g = '';
    rows.forEach((grp, r) => {
      const yh = top + r * (head + rowH + gap), y0 = yh + head, y1 = y0 + rowH;
      const vals = grp.points.map(p => p.dm);
      let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
      // at least ±0.4 mag, so a steady star (Barnard's Star, the control) reads as flat, not as noise blown up
      const half = Math.max(0.4, (hi - lo) / 2 * 1.15), mid = (hi + lo) / 2; lo = mid - half; hi = mid + half;
      const Y = v => y0 + (v - lo) / (hi - lo) * rowH; // brighter (negative Δm) up
      geo.rows.push({ y0, y1, Y, grp });
      g += `<text x="${L}" y="${yh + 11}" class="lc-gl">${esc(grp.name)} <tspan class="lc-ax">· Δ mag</tspan></text>`;
      for (const s of seasons) g += `<rect x="${s.x0}" y="${y0}" width="${pw}" height="${rowH}" class="lc-bg"/>`;
      // zero line per season panel, with a small "//" axis-break mark in each gap (the months left out)
      if (grp.points.length) for (const s of seasons) g += `<line x1="${s.x0}" x2="${s.x0 + pw}" y1="${Y(0)}" y2="${Y(0)}" class="lc-zero"/>`;
      if (grp.points.length) for (let k = 1; k < seasons.length; k++) g += brk(seasons[k].x0 - sg / 2, Y(0));
      const tk = Math.abs(hi) >= 0.5 || Math.abs(lo) >= 0.5 ? 1 : 2;
      if (grp.points.length) g += `<text x="${L - 5}" y="${y0 + 9}" class="lc-ax" text-anchor="end">${fmtMag(lo, tk)}</text><text x="${L - 5}" y="${y1}" class="lc-ax" text-anchor="end">${fmtMag(hi, tk)}</text>`;
      if (!grp.points.length) g += `<text x="${(L + W - Rr) / 2}" y="${y0 + rowH / 2 + 4}" class="lc-ax" text-anchor="middle"><title>${esc(emptyWhy(grp))}</title>${esc(plotWhy(grp))}</text>`;
      for (const s of grp.bySeason) g += `<line x1="${X(s.from) - 4}" x2="${X(s.to) + 4}" y1="${Y(s.dm)}" y2="${Y(s.dm)}" class="lc-mean"/>`;
      for (const p of grp.points) {
        const x = X(p.mjd), y = Y(p.dm), c = esc(colourOf(p.wl) || '#B5A898');
        g += SHAPE[grp.id] === 'square'
          ? `<rect class="lc-pt" data-i="${p.idx}" x="${x - 3}" y="${y - 3}" width="6" height="6" style="--pc:${c}"/>`
          : `<circle class="lc-pt" data-i="${p.idx}" cx="${x}" cy="${y}" r="3.3" style="--pc:${c}"/>`;
      }
    });
    // date axis: one label per season, under its panel; the same break mark on the panels' bottom edge
    const yb = geo.rows[geo.rows.length - 1]?.y1;
    if (yb != null) for (let k = 1; k < seasons.length; k++) g += brk(seasons[k].x0 - sg / 2, yb);
    for (const s of seasons) g += `<text x="${s.x0 + pw / 2}" y="${H - 5}" class="lc-ax" text-anchor="middle">${seasonLbl(s)}</text>`;
    g += '<path id="lcHead" class="lc-head" d=""/>'; // one segment per row, so it never crosses the row labels
    const label = `Brightness against date for ${S.name}: ` + rows.map(r => `${r.name}, ${r.points.length} images${r.ok ? `, last season ${fmtMag(r.dmag)} ± ${r.dmagErr.toFixed(2)} magnitudes against the first` : ''}`).join('; ') + '. Use left and right arrow keys to step through the plotted images.';
    plot.innerHTML = `<svg class="lc-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" tabindex="0" role="img" aria-label="${esc(label)}">${g}</svg>`;
    S.geo = geo;
    const svg = plot.firstChild;
    svg.addEventListener('pointermove', e => { const p = nearest(e); if (p?.idx !== S.hover?.idx) { S.hover = p; paint(); } });
    svg.addEventListener('pointerleave', () => { S.hover = null; paint(); });
    svg.addEventListener('click', e => { const p = nearest(e); if (p) onPick?.(p.idx); });
    svg.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); e.stopPropagation();
      const idx = [...new Set(S.lc.groups.flatMap(gr => gr.points.map(p => p.idx)))].sort((a, b) => a - b);
      if (!idx.length) return;
      const next = e.key === 'ArrowRight' ? idx.find(i => i > S.cur) ?? idx[0] : [...idx].reverse().find(i => i < S.cur) ?? idx[idx.length - 1];
      onPick?.(next);
    });
    paint();
  }

  // nearest plotted point to the pointer (within the row under it; 22 px reach so a tap lands)
  function nearest(e) {
    const geo = S.geo; if (!geo) return null;
    const r = plot.firstChild.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 22;
    for (const row of geo.rows) {
      if (y < row.y0 - 12 || y > row.y1 + 12) continue;
      for (const p of row.grp.points) { const d = Math.hypot(geo.X(p.mjd) - x, row.Y(p.dm) - y); if (d < bd) { bd = d; best = { ...p, group: row.grp }; } }
    }
    return best;
  }

  function pointAt(idx) {
    for (const g of S.lc?.groups || []) { const p = g.points.find(q => q.idx === idx); if (p) return { ...p, group: g }; }
    return null;
  }

  // playhead + selected point + readout (no re-render)
  function paint() {
    const geo = S.geo, svg = plot.firstChild;
    if (!geo || !svg || svg.tagName !== 'svg') return;
    const f = S.frames[S.cur];
    const head = svg.querySelector('#lcHead');
    if (f) { const x = geo.X(f.mjd).toFixed(1); head.setAttribute('d', geo.rows.map(r => `M${x} ${r.y0 - 2}V${r.y1 + 2}`).join('')); head.style.display = ''; } else head.style.display = 'none';
    svg.querySelectorAll('.lc-pt.on').forEach(el => el.classList.remove('on'));
    svg.querySelectorAll(`.lc-pt[data-i="${S.cur}"]`).forEach(el => el.classList.add('on'));
    svg.querySelectorAll('.lc-pt.hov').forEach(el => el.classList.remove('hov'));
    if (S.hover) svg.querySelectorAll(`.lc-pt[data-i="${S.hover.idx}"]`).forEach(el => el.classList.add('hov'));
    const p = S.hover || pointAt(S.cur);
    if (p) read.innerHTML = `${S.hover ? '' : '<b>This image</b> · '}${fmtDay(p.mjd)} · λ ${p.wl.toFixed(2)} µm · D${p.det} · ${fmtJy(p.mJy)} mJy · <b>${fmtMag(p.dm)} mag</b>`;
    else if (f) read.innerHTML = `<b>This image</b> · ${fmtDay(f.mjd)} · ${skipWhy(S.cur)}`;
    else read.textContent = '';
  }
  function skipWhy(idx) {
    const r = S.rows[idx]; if (!r) return '';
    if (r.masked) return `not plotted: a masked pixel within ${AP_ARCSEC}″`;
    if (!(r.flux > 0)) return 'not plotted: no light above the background';
    return 'not plotted: no first-season image at this wavelength';
  }

  let ro = null;
  if (window.ResizeObserver) { let w = 0; ro = new ResizeObserver(() => { const nw = Math.round(plot.clientWidth); if (nw && nw !== w) { w = nw; draw(); } }); ro.observe(plot); }

  // per wavelength group: { id, dets, absent, detect, src } (the SNR tool's "not the target" rule reuses this)
  return { data, mark, redraw: draw, groups: () => S.lc?.groups || [] };
}
