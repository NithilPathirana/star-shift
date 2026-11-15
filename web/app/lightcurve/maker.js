// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// "Make a light curve" dialog (judges' suggestion B). Opened from the Brightness-over-time panel or
// from a spot clicked on the image. The numbers come from make.js; this file only draws and wires.

import { makeCurve, bandSet, countsText, comparisonCandidates, autoPick, periodSearch, periodText, toCSV, encodeChoices,
  snapSource, APERTURES, MAX_COMPS, PERIOD_CAVEAT, SATURATED_TEXT, NOTHING_TEXT, ERR_NOTE, ERR_NOTE_COMP } from './make.js';
import { fieldGaia } from '../gaia-overlay.js';
import { GRID_ARCSEC, fmtMag, lightOnSky, pickSource, pickSaved, notHereText } from './logic.js';
import { groupInto, seasonMonths, seasonBounds } from '../seasons.js';

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (m) => { const d = new Date((m - 40587) * 864e5); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const SHAPES = ['circle', 'square', 'diamond', 'triangle', 'circle', 'square'];
const BAND_KINDS = [['proof', '2 groups (as Proof)'], ['dets', 'Detectors 1–6'], ['ranges', 'Your bands']];
const NS = 'http://www.w3.org/2000/svg';

let dlg = null, proofP = null;
const S = {}; // the open session: inputs, choices, results

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'lcm'; dlg.id = 'lcm'; dlg.setAttribute('aria-labelledby', 'lcmT');
  dlg.innerHTML = `
  <header class="lcm-h"><div><small>MAKE A LIGHT CURVE</small><h2 id="lcmT"></h2><p class="lcm-src" id="lcmSrc"></p></div>
    <button type="button" class="key icon lcm-x" id="lcmX" aria-label="Close">×</button></header>
  <div class="lcm-body">
    <section class="lcm-ctl" aria-label="Choices">
      <fieldset class="lcm-f"><legend class="lcm-l">Bands</legend>
        <div class="lcm-kind" id="lcmKind" role="radiogroup" aria-label="Band set">${BAND_KINDS.map(([k, t]) => `<button type="button" class="lcm-chip" role="radio" data-kind="${k}">${t}</button>`).join('')}</div>
        <div class="lcm-bands" id="lcmBands"></div></fieldset>
      <div class="lcm-f"><label class="lcm-l" for="lcmAp">Aperture (measuring circle)</label>
        <select id="lcmAp" class="lcm-sel">${APERTURES.map(a => `<option value="${a}">${a} px · ${Math.round(a * GRID_ARCSEC)}″ radius</option>`).join('')}</select></div>
      <label class="lcm-ck"><input type="checkbox" id="lcmFl"> Skip images with a quality flag on the source (signal jump, afterglow, scattered light, streak, airglow)</label>
      <fieldset class="lcm-f"><legend class="lcm-l">Comparison stars <span class="lcm-sub">(Gaia DR3, for differential photometry)</span></legend>
        <div id="lcmComps" class="lcm-comps"></div>
        <p class="lcm-note" id="lcmCompNote"></p></fieldset>
      <button type="button" class="key lcm-proof" id="lcmProof">Use the Proof page's choices</button>
    </section>
    <section class="lcm-out" aria-label="Light curve">
      <div class="lcm-plot" id="lcmPlot"></div>
      <div class="lcm-legend" id="lcmLeg"></div>
      <div class="lcm-sum" id="lcmSum"></div>
      <p class="lcm-cnt num" id="lcmCnt"></p>
      <p class="lcm-note" id="lcmErr"></p>
      <div class="lcm-keys"><button type="button" class="key" id="lcmCsv">Export CSV</button><button type="button" class="key" id="lcmNb">Add to notebook</button><button type="button" class="key" id="lcmLink">Copy link</button></div>
      <details class="lcm-per" id="lcmPer"><summary>Look for a period</summary>
        <p class="lcm-cav" id="lcmCav"></p><div class="lcm-pg" id="lcmPg"></div><div id="lcmPv"></div></details>
    </section>
  </div>`;
  document.body.appendChild(dlg);
  const $ = id => dlg.querySelector('#' + id);
  $('lcmCav').textContent = PERIOD_CAVEAT;
  $('lcmX').onclick = () => dlg.close();
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // the backdrop
  $('lcmKind').addEventListener('click', e => { const b = e.target.closest('[data-kind]'); if (!b) return; S.bandKind = b.dataset.kind; S.off = new Set(); update(); });
  $('lcmBands').addEventListener('change', e => { const c = e.target.closest('input[data-band]'); if (!c) return; c.checked ? S.off.delete(c.dataset.band) : S.off.add(c.dataset.band); update(); });
  $('lcmAp').onchange = e => { S.aperture = +e.target.value; S.cands = null; loadComps(); };
  $('lcmFl').onchange = e => { S.skipFlagged = e.target.checked; update(); };
  $('lcmComps').addEventListener('change', e => { const c = e.target.closest('input[data-comp]'); if (!c) return; c.checked ? S.chosen.add(c.dataset.comp) : S.chosen.delete(c.dataset.comp); update(); });
  $('lcmProof').onclick = () => { S.bandKind = 'proof'; S.off = new Set(); S.aperture = 2.5; S.skipFlagged = false; S.chosen = new Set(); S.cands = null; loadComps(true); };
  $('lcmCsv').onclick = exportCSV;
  $('lcmNb').onclick = addNotebook;
  $('lcmLink').onclick = copyLink;
  $('lcmPer').addEventListener('toggle', () => { S.period = $('lcmPer').open; if (S.period) drawPeriod(); });
  let w = 0;
  if (window.ResizeObserver) new ResizeObserver(() => { const nw = Math.round($('lcmPlot').clientWidth); if (nw && nw !== w && dlg.open) { w = nw; draw(); if (S.period) drawPeriod(); } }).observe($('lcmPlot'));
}
const q = id => dlg.querySelector('#' + id);

// opts: { frames, grid, bounds, name, preset, base, source ({ own: true } or { ra, dec, ... }), choices (decodeChoices),
//         ranges: () => the band editor's ranges, notebookAdd, toast, shareURL: () => the viewer link, isExpert }
export async function openMaker(opts) {
  if (!dlg) build();
  Object.assign(S, { ...opts, stars: null, cands: null, curve: null, gaiaFailed: false, nb: [] });
  if (!S.bounds?.length) S.bounds = seasonBounds(S.frames.map(f => f.mjd));
  const ch = opts.choices || {};
  S.bandKind = ch.bandKind || 'proof'; S.off = new Set(); S.aperture = ch.aperture || 2.5; S.skipFlagged = ch.skipFlagged ?? true; S.period = !!ch.period;
  S.wantComps = ch.comps; // ids from a link (null = auto-pick)
  S.chosen = new Set();
  S.source = opts.source || { own: true };
  q('lcmT').textContent = S.name || 'This object';
  q('lcmPer').open = S.period;
  if (!dlg.open) dlg.showModal();
  // the Proof page's saved Gaia neighbours of a demo target, as the Brightness-over-time panel names a blend with them
  proofP ||= fetch(new URL('../../data/proof.json', import.meta.url)).then(r => (r.ok ? r.json() : null)).catch(() => null);
  proofP.then(d => { const t = d?.targets?.find(q => q.name === S.name || q.label === S.name); S.nb = t?.extra?.neighbours || []; if (dlg.open && S.curve?.bands.some(b => b.absent)) summary(); });
  update(); // first draw with no comparison stars while Gaia answers
  try {
    S.stars = await fieldGaia({ grid: S.grid, preset: S.preset, base: S.base, signal: AbortSignal.timeout(20000) });
  } catch { S.stars = []; S.gaiaFailed = true; }
  if (!S.source.own && S.source.clicked) { // snap a clicked spot to a catalogued star (9″, 1.5 px)
    const mid = S.frames[Math.floor(S.frames.length / 2)]?.mjd;
    S.source = { ...snapSource(S.source.ra, S.source.dec, S.stars, mid), clicked: false };
  }
  loadComps(S.wantComps != null);
}

function loadComps(fromList) {
  const stars = S.stars || [];
  S.cands = comparisonCandidates(stars, S.frames, S.grid, { source: S.source, aperture: S.aperture })
    .filter(c => !(S.source.id && c.id === S.source.id));
  if (fromList && S.wantComps) { S.chosen = new Set(S.wantComps.filter(id => S.cands.some(c => c.id === id))); S.wantComps = null; }
  else if (!fromList) S.chosen = new Set(autoPick(S.cands, MAX_COMPS).map(c => c.id));
  update();
}

function bands() { return bandSet(S.bandKind, S.ranges?.() || []); }

function update() {
  if (!dlg) return;
  const all = bands(), on = all.filter(b => !S.off.has(b.id));
  // source line
  const src = S.source;
  q('lcmSrc').textContent = src.own ? `Source: ${S.name}, at its predicted position on each image's date.`
    : `Source: ${src.name || `the spot at ${src.ra.toFixed(4)}°, ${src.dec.toFixed(4)}°`}${src.id ? ', moved by its Gaia proper motion to each image\'s date' : ''}.`;
  // controls
  for (const b of q('lcmKind').querySelectorAll('[data-kind]')) b.setAttribute('aria-checked', String(b.dataset.kind === S.bandKind));
  q('lcmBands').innerHTML = all.length ? all.map(b => `<label class="lcm-band"><input type="checkbox" data-band="${esc(b.id)}"${S.off.has(b.id) ? '' : ' checked'}><i style="--bc:${esc(b.colour)}" aria-hidden="true"></i>${esc(b.long)}</label>`).join('')
    : '<p class="lcm-note">No band ranges yet: make some in the band editor (BANDS ▾).</p>';
  q('lcmAp').value = String(S.aperture);
  q('lcmFl').checked = S.skipFlagged;
  const C = S.cands;
  q('lcmComps').innerHTML = !S.stars ? '<p class="lcm-note">Asking Gaia DR3 for the stars in this 150″ field…</p>'
    : !C?.length ? '' : C.slice(0, 8).map(c => `<label class="lcm-comp${c.eligible ? '' : ' weak'}"><input type="checkbox" data-comp="${esc(c.id)}"${S.chosen.has(c.id) ? ' checked' : ''}>
      <span>${esc(c.id.replace('Gaia DR3 ', 'Gaia '))} · G ${c.g.toFixed(1)} · ${Math.round(c.sepArcsec)}″ away<small>clean in ${c.clean} of ${c.of} images${c.eligible ? '' : ' (under half: not auto-picked)'}</small></span></label>`).join('');
  q('lcmCompNote').textContent = S.gaiaFailed ? 'Gaia DR3 did not answer, so there are no comparison stars: the curve is direct photometry, as on the Proof page.'
    : !S.stars ? '' : !C?.length ? 'No Gaia star in this 150″ field is isolated, far enough from the source and measurable: the curve is direct photometry, as on the Proof page.'
    : `Auto-picked: up to ${MAX_COMPS} stars that are detected (S/N above 5) with no masked pixel, no saturation and no flag in at least half the images; in any one image a star is only used when it is clean there. Tick or untick to change. None ticked = direct photometry, as on the Proof page.`;
  // the curve
  const comps = (C || []).filter(c => S.chosen.has(c.id));
  S.comps = comps;
  S.curve = on.length ? makeCurve(S.frames, S.grid, { source: src, comps, aperture: S.aperture, bands: on, skipFlagged: S.skipFlagged }, S.bounds) : null;
  summary(); draw(); if (S.period) drawPeriod();
}

function summary() {
  const c = S.curve, sum = q('lcmSum'), cnt = q('lcmCnt'), err = q('lcmErr');
  if (!c) { sum.innerHTML = '<p class="lcm-msg">Choose at least one band.</p>'; cnt.textContent = ''; err.textContent = ''; return; }
  cnt.textContent = countsText(c);
  const ap = Math.round(S.aperture * GRID_ARCSEC);
  if (c.status === 'saturated') { // Proof's one meaning of saturated: every image masked within the aperture
    sum.innerHTML = `<p class="lcm-msg lcm-sat"><b>${esc(SATURATED_TEXT)}</b> Too bright for SPHEREx: ${c.counts.total === 1 ? 'the one image has' : `all ${c.counts.total} images have`} a masked pixel within ${ap}″ of ${S.source.own ? 'the star' : 'this spot'}, so its brightness can't be measured here.</p>`;
    err.textContent = ''; return;
  }
  if (c.status === 'nothing') {
    sum.innerHTML = `<p class="lcm-msg"><b>${esc(NOTHING_TEXT)}</b> No image shows light above the noise ${S.source.own ? `at ${esc(S.name)}'s position` : 'here'}${c.bands.some(b => b.absent && b.detect?.state === 'offset') ? ', or the light there is centred on another source' : ''}, so there is no light curve to draw.</p>`;
    err.textContent = ''; return;
  }
  const anyComp = c.bands.some(b => b.points.some(p => p.nComp));
  err.textContent = anyComp ? ERR_NOTE_COMP : ERR_NOTE;
  sum.innerHTML = c.bands.map(b => {
    const how = b.direct ? ' <span class="lcm-tag">direct: no comparison star measurable in this band</span>' : b.points.some(p => p.nComp) ? ' <span class="lcm-tag">differential</span>' : '';
    let v;
    if (b.ok) {
      const ratio = Math.pow(10, -0.4 * b.dmag), sig = b.sigma;
      const words = sig < 3 ? `no clear change between the first and last season (under 3 times its uncertainty)` : `${b.dmag > 0 ? 'fainter' : 'brighter'} in the last season than the first: about ${ratio >= 1 ? ratio.toFixed(1) + '×' : (ratio * 100).toFixed(0) + '%'} the brightness`;
      v = `<span class="x-only"><b>${fmtMag(b.dmag)} ± ${b.dmagErr.toFixed(2)} mag</b> last season vs first (${sig.toFixed(1)}σ)</span><span class="s-only">${esc(words)}</span>`;
    } else if (b.absent) { // the panel's a3 rule and wording: whose light it is, if it is not the source's
      const sky = lightOnSky(b.detect, S.grid), src = (S.source.own && pickSaved(S.nb, sky)) || (S.stars ? pickSource(S.stars, sky) : null); // saved first, as the panel
      v = esc(notHereText(b.detect, sky, src, S.source.own ? S.name : 'this source', /^0\.75/.test(b.name) ? 'below 3.8 µm' : `in ${b.name}`));
    } else v = b.points.length ? 'too few images in the first or last season to compare them' : b.masked === b.total && b.total ? `a masked pixel within ${ap}″ in every image` : 'nothing detected in this band';
    return `<div class="lcm-row"><span class="lcm-k"><i style="--bc:${esc(b.colour)}" aria-hidden="true"></i>${esc(b.name)}</span><span class="lcm-v">${v}${how}<small>${b.points.length} image${b.points.length === 1 ? '' : 's'}</small></span></div>`;
  }).join('');
}

// ---- Δmag against date: seasons side by side (as the Brightness-over-time strip), brighter up ----
function shape(kind, x, y, c, r = 3.4) {
  if (kind === 'square') return `<rect x="${x - r + .4}" y="${y - r + .4}" width="${2 * r - .8}" height="${2 * r - .8}" style="--pc:${c}" class="lcm-pt"/>`;
  if (kind === 'diamond') return `<path d="M${x} ${y - r - .6}L${x + r + .6} ${y}L${x} ${y + r + .6}L${x - r - .6} ${y}Z" style="--pc:${c}" class="lcm-pt"/>`;
  if (kind === 'triangle') return `<path d="M${x} ${y - r - .6}L${x + r + .4} ${y + r - .2}L${x - r - .4} ${y + r - .2}Z" style="--pc:${c}" class="lcm-pt"/>`;
  return `<circle cx="${x}" cy="${y}" r="${r}" style="--pc:${c}" class="lcm-pt"/>`;
}
function draw() {
  const plot = q('lcmPlot'), leg = q('lcmLeg'), c = S.curve;
  if (!c || c.status !== 'ok') { plot.innerHTML = c?.status === 'saturated' ? `<p class="lcm-pmsg">${esc(SATURATED_TEXT)}</p>` : c?.status === 'nothing' ? `<p class="lcm-pmsg">${esc(NOTHING_TEXT)}</p>` : c ? '<p class="lcm-pmsg">No image passes all the choices: nothing to plot.</p>' : ''; leg.innerHTML = ''; return; }
  const W = Math.max(260, Math.round(plot.clientWidth || 520)), H = 230, L = 46, R = 10, T = 10, B = 26;
  const pts = c.bands.flatMap((b, k) => b.points.map(p => ({ ...p, b, k })));
  const seasons = groupInto(pts.map(p => ({ mjd: p.mjd })).sort((a, b) => a.mjd - b.mjd), S.bounds)
    .filter(s => s.frames.length).map(s => ({ k: s.k, from: s.frames[0].mjd, to: s.frames[s.frames.length - 1].mjd, b: S.bounds[s.k] }));
  const sg = 10, pw = (W - L - R - sg * (seasons.length - 1)) / seasons.length;
  seasons.forEach((s, i) => { const pad = Math.max(1.5, (s.to - s.from) * 0.08); s.t0 = s.from - pad; s.t1 = s.to + pad; s.x0 = L + i * (pw + sg); });
  const X = m => { const s = seasons.find(z => m >= z.t0 && m <= z.t1) || seasons[0]; return s.x0 + (m - s.t0) / (s.t1 - s.t0) * pw; };
  const e = (p) => Math.min(p.err || 0, 0.5); // the scale follows the points; a long error bar is clipped at the edge
  const lo0 = Math.min(0, ...pts.map(p => p.dm - e(p))), hi0 = Math.max(0, ...pts.map(p => p.dm + e(p)));
  const half = Math.max(0.3, (hi0 - lo0) / 2 * 1.1), mid = (hi0 + lo0) / 2, lo = mid - half, hi = mid + half;
  const Y = v => T + (v - lo) / (hi - lo) * (H - T - B); // brighter (negative Δm) up
  let g = '';
  for (const s of seasons) g += `<rect x="${s.x0}" y="${T}" width="${pw}" height="${H - T - B}" class="lc-bg"/><line x1="${s.x0}" x2="${s.x0 + pw}" y1="${Y(0)}" y2="${Y(0)}" class="lc-zero"/>`
    + `<text x="${s.x0 + pw / 2}" y="${H - 8}" class="lc-ax" text-anchor="middle">${esc(s.b ? seasonMonths(s.b).replace(/ (\d\d)(\d\d)/g, ' $2') : fmtDay(s.from))}</text>`;
  const tk = half >= 0.6 ? 1 : 2;
  g += `<text x="${L - 6}" y="${T + 10}" class="lc-ax" text-anchor="end">${fmtMag(lo, tk)}</text><text x="${L - 6}" y="${Y(0) + 4}" class="lc-ax" text-anchor="end">0</text><text x="${L - 6}" y="${H - B}" class="lc-ax" text-anchor="end">${fmtMag(hi, tk)}</text>`;
  g += `<text x="12" y="${(H - B + T) / 2}" class="lc-ax" text-anchor="middle" transform="rotate(-90 12 ${(H - B + T) / 2})">Δ mag (brighter up)</text>`;
  // season means per band (dashed, band colour), then error bars, then points
  for (const b of c.bands) for (const s of b.bySeason) g += `<line x1="${X(s.from) - 4}" x2="${X(s.to) + 4}" y1="${Y(s.dm)}" y2="${Y(s.dm)}" class="lcm-mean" style="--pc:${esc(b.colour)}"/>`;
  for (const p of pts) if (p.err > 0) { const x = X(p.mjd).toFixed(1); g += `<line x1="${x}" x2="${x}" y1="${Y(Math.max(lo, p.dm - p.err)).toFixed(1)}" y2="${Y(Math.min(hi, p.dm + p.err)).toFixed(1)}" class="lcm-eb" style="--pc:${esc(p.b.colour)}"/>`; }
  for (const p of pts) g += `<g>${shape(SHAPES[p.k % SHAPES.length], +X(p.mjd).toFixed(1), +Y(p.dm).toFixed(1), esc(p.b.colour))}<title>${esc(`${p.b.name} · ${fmtDay(p.mjd)} · λ ${p.wl.toFixed(2)} µm · D${p.det} · ${fmtMag(p.dm)}${p.err != null ? ` ± ${p.err.toFixed(2)}` : ''} mag${p.nComp ? ` · ${p.nComp} comparison star${p.nComp > 1 ? 's' : ''}` : ''}`)}</title></g>`;
  for (let i = 1; i < seasons.length; i++) { const cx = seasons[i].x0 - sg / 2; g += `<text x="${cx}" y="${Y(0) + 4}" class="lc-ax" text-anchor="middle">//</text>`; }
  const label = `Light curve of ${S.name}: brightness change in magnitudes against date, ` + c.bands.map(b => `${b.name}: ${b.points.length} images${b.ok ? `, last season ${fmtMag(b.dmag)} ± ${b.dmagErr.toFixed(2)} mag against the first` : ''}`).join('; ') + '.';
  plot.innerHTML = `<svg class="lcm-svg" xmlns="${NS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${g}</svg>`;
  leg.innerHTML = c.bands.map((b, k) => `<span class="lcm-lg"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">${shape(SHAPES[k % SHAPES.length], 6, 6, esc(b.colour), 4)}</svg>${esc(b.name)}</span>`).join('')
    + '<span class="lcm-lg lcm-lg-m">dashed: season mean · seasons side by side, the months between left out</span>';
}

// ---- periodogram (power against period, log axis), only with its caveat ----
function drawPeriod() {
  const pg = q('lcmPg'), pv = q('lcmPv'), c = S.curve;
  if (!c || c.status !== 'ok') { pg.innerHTML = ''; pv.innerHTML = '<p class="lcm-note">No plotted images to search.</p>'; return; }
  const runs = c.bands.filter(b => b.points.length).map((b, k) => ({ b, k, ps: periodSearch(b.points) })).filter(r => r.ps.freqs.length);
  pv.innerHTML = c.bands.filter(b => b.points.length).map(b => { const r = runs.find(x => x.b === b); return `<p class="lcm-pvr"><i style="--bc:${esc(b.colour)}" aria-hidden="true"></i><b>${esc(b.name)}:</b> ${esc(periodText(r ? r.ps : periodSearch(b.points)))}</p>`; }).join('');
  if (!runs.length) { pg.innerHTML = ''; return; }
  const W = Math.max(260, Math.round(pg.clientWidth || 520)), H = 170, L = 40, R = 10, T = 8, B = 30;
  const allP = runs.flatMap(r => r.ps.freqs.map(f => 1 / f)), pLo = Math.min(...allP), pHi = Math.max(...allP);
  const X = P => L + (Math.log10(P) - Math.log10(pLo)) / (Math.log10(pHi) - Math.log10(pLo)) * (W - L - R);
  const Y = p => H - B - p * (H - T - B);
  const rg = runs[0].ps.range; // same dates in every band, to within a few images
  let g = `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" class="lc-bg"/>`;
  // shade what the sampling cannot find: shorter than twice the time between visits, longer than half the span
  const sh = (a, b2, t) => { const x0 = X(Math.max(pLo, a)), x1 = X(Math.min(pHi, b2)); if (x1 > x0 + 1) g += `<rect x="${x0}" y="${T}" width="${x1 - x0}" height="${H - T - B}" class="lcm-no"/><text x="${(x0 + x1) / 2}" y="${T + 13}" class="lc-ax" text-anchor="middle">${t}</text>`; };
  if (rg.ok) { sh(pLo, rg.pMin, "can't be found"); sh(rg.pMax, pHi, 'longer than half the span'); } else sh(pLo, pHi, "no period can be found with these dates");
  for (const r of runs) {
    const d = r.ps.freqs.map((f, i) => `${i ? 'L' : 'M'}${X(1 / f).toFixed(1)} ${Y(r.ps.power[i]).toFixed(1)}`).join('');
    g += `<path d="${d}" class="lcm-pgl" style="--pc:${esc(r.b.colour)}"/>`;
    if (r.ps.level1 <= 1) g += `<line x1="${L}" x2="${W - R}" y1="${Y(r.ps.level1)}" y2="${Y(r.ps.level1)}" class="lcm-fap" style="--pc:${esc(r.b.colour)}"><title>1% false-alarm level</title></line>`;
  }
  const ticks = [1, 3, 10, 30, 100, 300, 1000].filter(P => P >= pLo && P <= pHi);
  for (const P of ticks) g += `<text x="${X(P)}" y="${H - 14}" class="lc-ax" text-anchor="middle">${P}</text>`;
  g += `<text x="${(L + W - R) / 2}" y="${H - 2}" class="lc-ax" text-anchor="middle">period (days) · dashed: 1% false-alarm level</text>`;
  g += `<text x="${L - 6}" y="${T + 9}" class="lc-ax" text-anchor="end">1</text><text x="${L - 6}" y="${H - B}" class="lc-ax" text-anchor="end">0</text>`;
  pg.innerHTML = `<svg class="lcm-svg" xmlns="${NS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lomb–Scargle periodogram: power against period. ${esc(pv.textContent)}">${g}</svg>`;
}

// ---- keys ----
const fileName = () => `${(S.name || 'source').replace(/[^\w-]+/g, '_')}_light_curve.csv`;
function exportCSV() {
  if (!S.curve) return;
  const blob = new Blob([toCSV(S.curve, S.source.own ? S.name : (S.source.name || S.name))], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName();
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  S.toast?.(`Saved ${fileName()}`);
}
function link() {
  const base = S.shareURL?.() || location.href;
  const u = new URL(base);
  u.searchParams.set('lc', encodeChoices({ bandKind: S.bandKind, aperture: S.aperture, skipFlagged: S.skipFlagged, comps: S.comps || [], source: S.source, period: S.period }));
  return u.toString();
}
function copyLink(e) {
  const url = link(), b = e.currentTarget;
  try { navigator.clipboard?.writeText(url)?.catch?.(() => {}); } catch { /* no clipboard */ }
  b.dataset.url = url; b.textContent = 'Link copied'; setTimeout(() => { b.textContent = 'Copy link'; }, 1600);
  S.toast?.('Link copied: opens this light curve with the same choices');
}
function addNotebook(e) {
  const c = S.curve; if (!c) return;
  const parts = c.status === 'saturated' ? [SATURATED_TEXT] : c.status === 'nothing' ? [NOTHING_TEXT] : c.bands.map(b => `${b.name}: ${b.ok ? `${fmtMag(b.dmag)} ± ${b.dmagErr.toFixed(2)} mag last season vs first` : `${b.points.length} images, no season comparison`}`);
  const how = `aperture ${Math.round(S.aperture * GRID_ARCSEC)}″, ${S.comps?.length ? `${S.comps.length} comparison star${S.comps.length > 1 ? 's' : ''}` : 'no comparison stars'}${S.skipFlagged ? ', flagged images skipped' : ''}`;
  const mj = S.frames.map(f => f.mjd);
  try {
    S.notebookAdd?.({ label: `${S.name}: light curve${S.source.own ? '' : ` of ${S.source.name || 'a clicked spot'}`}`, value: `${parts.join('; ')} (${how}; ${countsText(c)})`, unit: '', uncertainty: '',
      source: 'SPHEREx images via IRSA; aperture photometry in Star Shift (Make a light curve)', tag: 'OBSERVED',
      context: { page: 'Viewer', ra: S.source.own ? +S.grid.ra0.toFixed(5) : +S.source.ra.toFixed(5), dec: S.source.own ? +S.grid.dec0.toFixed(5) : +S.source.dec.toFixed(5),
        date: `${fmtDay(Math.min(...mj))} to ${fmtDay(Math.max(...mj))}`, url: link() } });
    e.currentTarget.textContent = 'Added to notebook'; const b = e.currentTarget; setTimeout(() => { b.textContent = 'Add to notebook'; }, 1600);
    S.toast?.('Saved to your lab notebook: the light curve');
  } catch { S.toast?.("Couldn't save to the notebook (browser storage blocked?)."); }
}

export const makerOpen = () => !!dlg?.open;
export const makerState = () => S; // for the page check and tests
