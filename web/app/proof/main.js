// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// "How we know" page (DESIGN.md 32): renders web/data/proof.json, which tools/make_proof.mjs
// computes with the app's own pipeline. Nothing here measures anything; it only draws.

import { initClarity, showPop, closePop, esc } from '../archive/shell.js';
import { DEFAULT_BANDS } from '../bands.js';
import { VERDICT_CLASS, along } from './logic.js';
import '../expert.js'; // Simple / Expert: .x-only (expert detail) and .s-only (plain-words twin)

const $ = (id) => document.getElementById(id);
const DASH = (why) => `<span class="dim" title="${esc(why)}">—</span>`;
const arcs = (masYr, d = 2) => (masYr / 1000).toFixed(d);
const sgn = (v, d = 2) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
const chip = (v) => `<span class="pf-chip ${VERDICT_CLASS[v] || ''}">${esc(v)}</span>`;
const mjdDate = (mjd) => new Date((mjd - 40587) * 86400000);
const fmtDay = (d) => d.toISOString().slice(0, 10);
// Simple / Expert twins. Simple shows plain words; Expert adds ±, σ, detectors and full sources.
const X = (h, tag = 'span', cls = '') => `<${tag} class="x-only ${cls}">${h}</${tag}>`;
const Sm = (h, tag = 'span') => `<${tag} class="s-only">${h}</${tag}>`;
const plainYr = (masYr, d = 1) => `${(masYr / 1000).toFixed(d)}″ a year`;
const shortSource = (s) => String(s).split(/ \(via|,/)[0].trim();
const plainGroup = (name) => String(name).replace(/\s*\(detectors[^)]*\)/, '');
const bandColor = (um) => (DEFAULT_BANDS.find(b => um >= b.min && um < b.max) || DEFAULT_BANDS[DEFAULT_BANDS.length - 1]).color;

/* ---------- shell: Clarity + Pages ---------- */
initClarity();
const toggler = (popId, btnId) => (e) => { e.stopPropagation(); $(popId).hidden ? showPop($(popId), $(btnId)) : closePop(); };
$('clarityBtn').onclick = toggler('clarity', 'clarityBtn');
$('pagesBtn').onclick = toggler('pagesPop', 'pagesBtn');
document.addEventListener('click', (e) => { const p = document.querySelector('.pop:not([hidden])'); if (p && !p.contains(e.target)) closePop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(true); });

/* ---------- table cells ---------- */
function expectedCell(t) {
  const x = t.expected;
  if (t.type === 'motion') return `<span class="num pf-big">${X(`${arcs(x.value)}″/yr`)}${Sm(plainYr(x.value, 2))}</span>`
    + X(`${esc(x.source)}${x.err != null ? ` · ±${x.err} mas/yr` : ''}`, 'small') + Sm(esc(shortSource(x.source)), 'small');
  return `<span class="pf-txt">${esc(x.text)}</span>${X(esc(x.source), 'small')}${Sm(esc(shortSource(x.source)), 'small')}`;
}
// What the measurability rule counted (same words as the rule): "saturation flag in 120/120;
// centre blanked in 81/120 (68%, under the 90% limit)". Shown where the flag is in 10%+ of images.
function countsLine(t) {
  const c = t.counts;
  if (!c || !(c.saturationFlag >= 0.1 * c.images)) return '';
  let blank = '';
  if (c.blanked != null && c.fitted) {
    const pct = Math.round(100 * c.blanked / c.fitted), lim = Math.round(100 * c.limitFrac);
    blank = `; centre blanked in ${c.blanked}/${c.fitted} (${pct}%, ${c.blanked / c.fitted >= c.limitFrac ? 'at or over' : 'under'} the ${lim}% limit)`;
  }
  return `<small class="num pf-counts">saturation flag in ${c.saturationFlag}/${c.images}${blank}</small>`;
}
const floorLine = (txt) => (txt ? `<small class="num pf-floor">${esc(txt)}</small>` : '');
const fromCat = (src) => (/^Gaia/.test(src) ? 'Gaia' : 'the catalogue');
function measuredCell(t, target) {
  const m = t.measured;
  if (t.type === 'motion') {
    if (!m || t.verdict === 'NOT MEASURABLE') {
      const why = t.shiftPx != null && t.shiftPx < 1 ? 'it moves under one pixel over these dates' : 'see the limits column';
      return `${DASH('Not measurable: see the limits column')}<small class="dim">Not measurable: ${why}</small>${countsLine(t)}${floorLine(t.fitAnyway?.floorText)}`;
    }
    const ss = m.seasons.length, d = t.diff, w = t.window, src = fromCat(t.expected.source);
    const val = m.significant === false ? `no significant motion ${X(`(&lt; ${arcs(m.upperLimit)}″/yr)`)}${Sm(`(under ${plainYr(m.upperLimit)})`)}`
      : `${X(`${arcs(m.value)} ± ${arcs(m.err)}″/yr${d?.sigma != null ? ` · ${d.sigma}σ` : ''}`)}${Sm(`${(m.value / 1000).toFixed(1)} ± ${(m.err / 1000).toFixed(1)}″ a year${d?.sigma != null ? ` · ${d.sigma}σ from ${src}` : ''}`)}`;
    const v = t.direction;
    const dir = v ? `<small class="num pf-dir">${X(`direction ${v.measured}° vs ${v.catalogue}° · ${Math.abs(v.paDiff).toFixed(1)}° off, ${arcs(v.sideways, 1)}″/yr sideways · ${v.sigma.toFixed(1)}σ`)}${Sm(`direction ${Math.abs(v.paDiff).toFixed(1)}° off ${src === 'Gaia' ? "Gaia's" : "the catalogue's"}, about ${arcs(v.sideways, 1)}″ a year sideways · ${v.sigma.toFixed(1)}σ`)}</small>` : '';
    const half = w && w.paLo != null ? (((w.paHi - w.paLo + 360) % 360) / 2).toFixed(1) : null;
    const win = w ? `<small class="num pf-win"><span class="dim">${X(`would agree from ${arcs(w.lo)} to ${arcs(w.hi)}″/yr${half ? `, pointing ${w.paLo}° to ${w.paHi}°` : ''}`)}${Sm(`would agree from ${(w.lo / 1000).toFixed(1)} to ${(w.hi / 1000).toFixed(1)}″ a year${half ? `, pointing within ${half}°` : ''}`)}</span></small>` : '';
    return `<span class="num pf-big">${val}</span>${dir}${win}${floorLine(m.floorText)}${countsLine(t)}${X(`${m.frames} images · ${ss} season${ss === 1 ? '' : 's'} · ${m.span} yr · ${esc(m.bands)}`, 'small', 'num')}${Sm(`${m.frames} images over ${m.span} years`, 'small')}`;
  }
  if (!m) return DASH('Not measurable: see the limits column');
  return m.groups.map(g => g.ok
    ? `<span class="num pf-line">${X(`${sgn(g.value)} ± ${g.err.toFixed(2)} mag`)}${Sm(`${Math.abs(g.value).toFixed(1)} mag`)} <span class="dim">${g.value > 0 ? 'fainter' : 'brighter'}</span></span>${X(`${esc(g.name)} · ${g.frames} images`, 'small', 'num')}${Sm(`at ${esc(plainGroup(g.name))}`, 'small')}`
    : `<span class="pf-line">${DASH('Too few usable images in this wavelength group')}</span><small class="num">${esc(g.name)}</small>`).join('');
}
function diffCell(t) {
  if (!t.diff) return DASH(t.verdict === 'NOT MEASURABLE' ? 'Nothing measured to compare' : 'No difference computed');
  if (t.type === 'motion') return `<span class="num pf-big">${sgn(t.diff.value / 1000)}″/yr</span> <small class="num">${t.diff.sigma} σ speed</small>`
    + (t.direction ? ` <span class="num pf-line">${arcs(t.direction.value)}″/yr</span><small class="num" title="Measured minus catalogue as an arrow: χ ${t.direction.chi2d.toFixed(2)} over 2 degrees of freedom, the same chance as ${t.direction.sigma.toFixed(1)}σ in one dimension">${t.direction.sigma.toFixed(1)} σ direction</small>` : '');
  return t.measured.groups.map(g => g.ok ? `<span class="num pf-line">${g.sigma} σ</span><small>change ÷ uncertainty</small>` : `<span class="pf-line">${DASH('Not measured')}</span><small>&nbsp;</small>`).join('');
}

/* ---------- charts (dark stage, DESIGN.md 25) ---------- */
const W = 560, H = 230, PAD = { l: 52, r: 16, t: 14, b: 34 };
function axes(x0, x1, y0, y1, ylab, invert = false) {
  const sx = (v) => PAD.l + (v - x0) / (x1 - x0) * (W - PAD.l - PAD.r);
  const sy = (v) => { const f = (v - y0) / (y1 - y0); return invert ? PAD.t + f * (H - PAD.t - PAD.b) : H - PAD.b - f * (H - PAD.t - PAD.b); };
  const ticks = (a, b, n) => { const step = niceStep((b - a) / n); const out = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(6)); return out; };
  let g = '';
  for (const v of ticks(y0, y1, 4)) g += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(v)}" y2="${sy(v)}" class="pf-grid"/><text x="${PAD.l - 6}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`;
  // month ticks
  const d0 = mjdDate(x0), months = [];
  for (let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); d <= mjdDate(x1); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1))) months.push(d);
  for (const d of months) { const x = sx(d.getTime() / 86400000 + 40587); g += `<text x="${x}" y="${H - PAD.b + 16}" text-anchor="middle">${d.toISOString().slice(0, 7)}</text>`; }
  g += `<text x="14" y="${(H - PAD.b + PAD.t) / 2}" transform="rotate(-90 14 ${(H - PAD.b + PAD.t) / 2})" text-anchor="middle">${esc(ylab)}</text>`;
  return { sx, sy, g };
}
function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(raw || 1)); const f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }
const svg = (inner, label) => `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" class="pf-svg">${inner}</svg>`;

function motionChart(t, target) {
  const c = t.chart; if (!c) return '';
  const pa = c.pa, yr = (mjd) => 2000 + (mjd - 51544.5) / 365.25;
  const pts = c.points.map(p => ({ mjd: p.mjd, s: along(p.e, p.n, pa) }));
  const fitS = (mjd) => along(c.fit.ae + c.fit.be * yr(mjd), c.fit.an + c.fit.bn * yr(mjd), pa);
  const x0 = pts[0].mjd - 10, x1 = pts[pts.length - 1].mjd + 10;
  const mid = (x0 + x1) / 2, catS = (mjd) => fitS(mid) + c.catalogueMasYr / 1000 * (mjd - mid) / 365.25;
  const ys = pts.map(p => p.s).concat([fitS(x0), fitS(x1), catS(x0), catS(x1)]);
  const lo = Math.min(...ys), hi = Math.max(...ys), padY = (hi - lo) * 0.08 || 1;
  const A = axes(x0, x1, lo - padY, hi + padY, '″ along the motion');
  let g = A.g;
  g += `<line class="pf-cat" x1="${A.sx(x0)}" y1="${A.sy(catS(x0))}" x2="${A.sx(x1)}" y2="${A.sy(catS(x1))}"/>`;
  g += `<line class="pf-fit" x1="${A.sx(x0)}" y1="${A.sy(fitS(x0))}" x2="${A.sx(x1)}" y2="${A.sy(fitS(x1))}"/>`;
  for (const p of pts) g += `<circle class="pf-pt" cx="${A.sx(p.mjd).toFixed(1)}" cy="${A.sy(p.s).toFixed(1)}" r="3"><title>${fmtDay(mjdDate(p.mjd))} · ${p.s.toFixed(2)}″ · OBSERVED</title></circle>`;
  const key = `<p class="pf-key"><span><i class="pf-k-pt"></i>image position <span class="tag obs">OBSERVED</span></span><span><i class="pf-k-fit"></i>fitted line <span class="tag comp">COMPUTED</span></span><span><i class="pf-k-cat"></i>catalogue motion <span class="tag cat">CATALOGUE</span></span></p>`;
  return svg(g, `${target.label}: position along the direction of motion against date`) + key;
}

function brightnessChart(t, target) {
  const c = t.chart; if (!c) return '';
  const all = c.groups.flatMap(gr => gr.points);
  const x0 = Math.min(...all.map(p => p.mjd)) - 10, x1 = Math.max(...all.map(p => p.mjd)) + 10;
  const ys = all.map(p => p.dm), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), padY = (hi - lo) * 0.08 || 0.1;
  const A = axes(x0, x1, lo - padY, hi + padY, 'Δ mag (brighter up)', true);
  let g = A.g + `<line class="pf-zero" x1="${PAD.l}" x2="${W - PAD.r}" y1="${A.sy(0)}" y2="${A.sy(0)}"/>`;
  c.groups.forEach((gr, k) => {
    for (const p of gr.points) {
      const x = A.sx(p.mjd).toFixed(1), y = A.sy(p.dm).toFixed(1), col = bandColor(p.wl), tip = `<title>${fmtDay(mjdDate(p.mjd))} · ${p.wl} µm · ${sgn(p.dm)} mag · OBSERVED</title>`;
      g += k === 0 ? `<circle cx="${x}" cy="${y}" r="3.2" fill="none" stroke="${col}" stroke-width="1.4">${tip}</circle>` : `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" fill="none" stroke="${col}" stroke-width="1.4">${tip}</rect>`;
    }
    const S = gr.seasons.filter(s => s.n);
    if (S.length > 1) g += `<polyline class="pf-mean pf-mean-${k}" points="${S.map(s => `${A.sx(s.mjd).toFixed(1)},${A.sy(s.dm).toFixed(1)}`).join(' ')}"/>`;
    for (const s of S) {
      const x = A.sx(s.mjd), e = s.sem || 0;
      g += `<line class="pf-err pf-mean-${k}" x1="${x}" x2="${x}" y1="${A.sy(s.dm - e)}" y2="${A.sy(s.dm + e)}"/>`;
      g += k === 0 ? `<circle class="pf-mean-pt pf-mean-${k}" cx="${x}" cy="${A.sy(s.dm)}" r="5"><title>${esc(gr.name)} · season ${s.from} to ${s.to} · ${sgn(s.dm)} ± ${(s.sem ?? 0).toFixed(2)} mag · ${s.n} images</title></circle>`
        : `<rect class="pf-mean-pt pf-mean-${k}" x="${x - 5}" y="${A.sy(s.dm) - 5}" width="10" height="10"><title>${esc(gr.name)} · season ${s.from} to ${s.to} · ${sgn(s.dm)} ± ${(s.sem ?? 0).toFixed(2)} mag · ${s.n} images</title></rect>`;
    }
  });
  const key = `<p class="pf-key"><span><i class="pf-k-c"></i>${esc(c.groups[0].name)}</span><span><i class="pf-k-s"></i>${esc(c.groups[1].name)}</span><span>small marks: single images, coloured by wavelength <span class="tag obs">OBSERVED</span></span><span>large marks: season average ± error <span class="tag comp">COMPUTED</span></span></p>`;
  return svg(g, `${target.label}: brightness change against date`) + key;
}

/* ---------- evidence (expanded row) ---------- */
function facts(t, target) {
  const li = []; // entries: html, or [html, 'x'] for Expert-only detail
  if (t.type === 'motion') {
    const v = t.variants, f = (x) => (x.ok ? `${arcs(x.total)} ± ${arcs(x.totalErr)}″/yr (${x.frames} images)` : `no fit (${esc(x.reason || 'no steady track')})`);
    if (t.fitAnyway) li.push(t.fitAnyway.significant === false
      ? `No significant motion ${X(`(&lt; ${arcs(t.fitAnyway.upperLimit)}″/yr): the fit gives ${arcs(t.fitAnyway.value)} ± ${arcs(t.fitAnyway.err)}″/yr`)}${Sm(`(under ${plainYr(t.fitAnyway.upperLimit)}): the fit gives ${plainYr(t.fitAnyway.value)}`)} from ${t.fitAnyway.frames} images, for a star the catalogue says moves ${arcs(t.expected.value, 3)}″/yr.`
      : `The fit gives ${X(`${arcs(t.fitAnyway.value)} ± ${arcs(t.fitAnyway.err)}″/yr`)}${Sm(plainYr(t.fitAnyway.value))} from ${t.fitAnyway.frames} images, for a star the catalogue says moves ${arcs(t.expected.value, 3)}″/yr. That is not a real motion (see the limits column).`);
    if (t.measured?.statErr != null) li.push([`Uncertainty: ± ${arcs(t.measured.statErr)}″/yr from the scatter of the image positions and the systematic ${esc(t.measured.floorText || `floor ± ${arcs(t.measured.sysErr)}″/yr`)}, combined as ± ${arcs(t.measured.err)}″/yr.`, 'x']);
    if (t.measured) li.push([`Direction of motion: measured ${t.measured.pa}°, catalogue ${t.expected.pa}° (east of north)${t.direction ? `; measured minus catalogue = ${sgn(t.direction.east / 1000)}″/yr east, ${sgn(t.direction.north / 1000)}″/yr north: χ = √((Δe/σe)² + (Δn/σn)²) = ${t.direction.chi2d} over 2 degrees of freedom, the same chance as ${t.direction.sigma}σ in one dimension` : ''}.`, 'x']);
    if (t.measured) li.push([`Seasons used: ${t.measured.seasons.map(s => `${s.from} to ${s.to} (${s.n})`).join(' · ')}.`, 'x']);
    if (t.measured) li.push([`Direction: measured within ${Math.round(Math.abs(((t.measured.pa - t.expected.pa + 540) % 360) - 180))}° of the catalogue direction.`, 's']);
    li.push([`All detectors: ${f(v.all)} · detectors 1–4: ${f(v.short)} · detectors 5–6: ${f(v.long)} · every flagged image hidden: ${f(v.filtersOn)}.`, 'x']);
    li.push(`Expected shift over these dates: ${X(`${t.shiftPx} of a 6.15″ pixel`)}${Sm(`about ${(+t.shiftPx).toFixed(1)} pixels (each 6.15″ wide)`)}.`);
    const ex = target.extra || {};
    if (ex.neighbours?.length) li.push([`Gaia DR3 sources within 15″: ${ex.neighbours.map(n => `G ${n.g} at ${n.sepArcsec}″`).join(', ')}.`, 'x']);
    if (ex.neighbours?.length) li.push([`${ex.neighbours.length} fainter star${ex.neighbours.length === 1 ? '' : 's'} within 15″ in Gaia.`, 's']);
    if (ex.brightNeighbour) li.push(`${esc(ex.brightNeighbour.name)}: ${ex.brightNeighbour.sepArcsec}″ away; the patch reaches ${ex.brightNeighbour.cutoutHalfArcsec}″ from the centre.`);
  } else if (t.measured) {
    for (const g of t.measured.groups) li.push(`${esc(g.name)}: ${g.seasons.map(s => `${s.from}: ${sgn(s.dm)}${s.sem != null ? X(` ± ${s.sem.toFixed(2)}`) : ''} mag (${s.n})`).join(' · ') || 'no usable images'}.`);
  }
  const im = target.images;
  li.push([`Images: ${im.loaded} loaded of ${im.archive} in the archive, ${im.first} to ${im.last}; star's centre flagged saturated in ${im.saturatedCore}; ${im.flaggedNearStar} have a flag that touches the star.`, 'x']);
  const mon = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  li.push([`Images: ${im.loaded} of the ${im.archive} in the archive, ${mon(im.first)} to ${mon(im.last)}; the star's centre is too bright (saturated) in ${im.saturatedCore} of them.`, 's']);
  return `<ul class="pf-facts">${li.map(x => Array.isArray(x) ? `<li class="${x[1] === 'x' ? 'x-only' : 's-only'}">${x[0]}</li>` : `<li>${x}</li>`).join('')}</ul>`;
}
function evidence(t, target) {
  const chart = t.type === 'motion' ? motionChart(t, target) : brightnessChart(t, target);
  const title = t.type === 'motion' ? 'Position against date, with the fitted line' : 'Brightness against date, compared with the first season';
  return `<div class="pf-ev"><div class="pf-stage">${chart ? `<p class="pf-cap">${title}</p>${chart}` : `<p class="pf-cap">No chart: nothing could be measured.</p>`}</div>
    <div class="pf-evside">${facts(t, target)}<a class="key" href="${esc(target.viewer)}">Open in the viewer</a></div></div>`;
}

/* ---------- render ---------- */
function render(d) {
  $('rules').innerHTML = [['Moves (proper motion): speed', d.rules.motion], ...(d.rules.direction ? [['Moves: direction', d.rules.direction]] : []), ['Changes brightness', d.rules.brightness]].map(([h, rs]) =>
    `<div><h3>${h}</h3><dl class="pf-rule">${rs.map(([v, txt]) => `<dt>${chip(v)}</dt><dd>${esc(txt)}</dd>`).join('')}</dl></div>`).join('')
    + `<p class="pf-rule-note">σ is the measurement's uncertainty, with the catalogue's added. For motion it is the scatter of the image positions plus a systematic floor in each direction: the field stars' own floor where 3 or more are usable in the patch, otherwise ${arcs(d.settings.sysFloorMasYr)}″/yr, measured on the field stars of all five patches together. Each row says which. A result that looks bad stays in the table with its reason.</p>`;
  let rows = '', k = 0;
  for (const target of d.targets) {
    rows += `<tbody class="pf-group">`;
    target.tests.forEach((t, i) => {
      const id = `ev${k++}`;
      rows += `<tr class="pf-row" data-ev="${id}">
        <td class="pf-obj"><button class="pf-open" type="button" aria-expanded="false" aria-controls="${id}"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5L7.5 6 4 9.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><b>${esc(target.label)}</b></button><small>${t.type === 'motion' ? 'moves' : 'changes brightness'}${i === 0 && target.kind === 'changes brightness' && t.type === 'motion' ? ' (checked too)' : ''}</small></td>
        <td class="pf-exp">${expectedCell(t)}</td>
        <td class="pf-meas">${measuredCell(t, target)}</td>
        <td class="pf-diff x-only">${diffCell(t)}</td>
        <td class="pf-ver">${chip(t.verdict)}${t.direction ? ` ${chip(t.direction.verdict)}` : ''}</td>
        <td class="pf-lim"><span class="pf-lim-t">${esc(t.limit)}</span></td></tr>
        <tr class="drow pf-drow" id="${id}" hidden><td colspan="6">${evidence(t, target)}</td></tr>`;
    });
    rows += `</tbody>`;
  }
  const tb = $('rows'); tb.insertAdjacentHTML('beforebegin', rows); tb.remove();
  document.querySelectorAll('.pf-row').forEach(r => {
    const btn = r.querySelector('.pf-open'), ev = document.getElementById(r.dataset.ev);
    const toggle = () => { const open = ev.hidden; ev.hidden = !open; btn.setAttribute('aria-expanded', String(open)); r.classList.toggle('pf-on', open); };
    btn.onclick = (e) => { e.stopPropagation(); toggle(); };
    r.onclick = (e) => { if (!e.target.closest('a,button')) toggle(); };
  });
  const when = new Date(d.generated);
  $('under').innerHTML = `<span class="s-only">Each result uses up to ${d.settings.maxImages} SPHEREx images of the object, computed ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}. Open a row to see its evidence.</span><span class="x-only num">${esc('Images behind each result: ' + d.targets.map(t => `${t.label}: ` + t.tests.map(x => {
    const n = x.verdict === 'NOT MEASURABLE' ? null : x.measured?.frames;
    return `${x.type} ${n != null ? `${n} of ${t.images.loaded}` : 'none (not measurable)'}`;
  }).join(', ')).join(' · ') + `. Computed ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC, field ${d.settings.fovArcmin}′, up to ${d.settings.maxImages} images per object, flag filter: ${d.settings.flagFilter}.`)}</span>`;

  // "What this does not show": the limits that apply to every row, with the numbers from this run.
  const rw = d.targets.find(t => t.key === 'rw-aur')?.tests[0].fitAnyway, rwAll = d.targets.find(t => t.key === 'rw-aur')?.tests[0].variants;
  const rd = d.targets.find(t => t.key === 'r-dra');
  const spans = d.targets.map(t => t.tests[0].measured?.span).filter(Number.isFinite);
  const seas = d.targets.map(t => t.images.seasons.length);
  $('notList').innerHTML = [
    `Pixels are 6.15″ wide. The fast stars here move only 1 to 2 pixels over the dates we have, so each position is a fraction of a pixel.`,
    `The images cover about ${Math.min(...spans).toFixed(1)} to ${Math.max(...spans).toFixed(1)} years in ${Math.min(...seas)} to ${Math.max(...seas)} seasons. The motion is fitted as a straight line after taking out the yearly parallax wobble (up to 0.55″ for Barnard's Star), using the catalogue parallax.`,
    `Error bars include a systematic floor of ${arcs(d.settings.sysFloorMasYr ?? 150)}″/yr in each direction, measured on field stars that should not move. It covers shifts common to the whole image, not every effect of a very bright or saturated centre: Barnard's Star's direction is off by more than the floor allows, most likely for that reason.`,
    rw ? (rw.significant === false
      ? `A motion under 3 times its error bar, or under ${arcs(d.settings.minMotionMasYr ?? 700, 1)}″/yr, is shown as "no significant motion". The 0.7″/yr line comes from RW Aurigae, which hardly moves but gives ${arcs(rw.value)} ± ${arcs(rw.err)}″/yr here${rwAll?.filtersOn?.ok ? ` and ${arcs(rwAll.filtersOn.total)}″/yr with every flagged image hidden` : ''}: a drift of its own light that the field stars do not show.`
      : `RW Aurigae, which hardly moves, comes out at ${arcs(rw.value)} ± ${arcs(rw.err)}″/yr, more than its error bar allows, so motions below about half an arcsecond per year are not claimed.`) : null,
    `No calibration across images beyond the archive's own: brightness is compared only between images from the same detector at the same wavelength, and catalogue amplitudes measured in visible light cannot be compared with these infrared changes.`,
    rd ? `Very bright stars saturate. R Draconis has its centre masked in ${rd.images.saturatedCore} of ${rd.images.loaded} images, so neither its motion nor its brightness can be read.` : null,
    `These are ${d.settings.maxImages} images per object spread evenly in time, as the viewer loads them, not every image in the archive.`,
  ].filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('');
}

fetch('data/proof.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(render).catch(e => {
  $('rows').innerHTML = `<tr><td colspan="6" class="empty">The measurements file could not be read (${esc(e.message)}). Run <span class="num">node tools/make_proof.mjs</span> with the server on, then reload.</td></tr>`;
});
