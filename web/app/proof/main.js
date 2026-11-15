// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// "How we know" page (DESIGN.md 32): renders web/data/proof.json, which tools/make_proof.mjs
// computes with the app's own pipeline. Nothing here measures anything; it only draws.

import { initClarity, showPop, closePop, esc } from '../archive/shell.js';
import { DEFAULT_BANDS } from '../bands.js';
import { VERDICT_CLASS, along, nmReason, mainGroup, plainBand, whySentence, badgeText, verdictSigma } from './logic.js';
import '../expert.js'; // Simple / Expert: .x-only (expert detail) and .s-only (plain-words twin)

const $ = (id) => document.getElementById(id);
const DASH = (why) => `<span class="dim" title="${esc(why)}">—</span>`;
const arcs = (masYr, d = 2) => (masYr / 1000).toFixed(d);
const sgn = (v, d = 2) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
const chip = (v, sigma, type) => `<span class="pf-chip ${VERDICT_CLASS[v] || ''}">${esc(badgeText(v, sigma, type))}</span>`; // σ: proof/logic.js badgeText
const mjdDate = (mjd) => new Date((mjd - 40587) * 86400000);
const fmtDay = (d) => d.toISOString().slice(0, 10);
const shortSource = (s) => String(s).split(/ \(via|[,;]/)[0].trim();
const bandColor = (um) => (DEFAULT_BANDS.find(b => um >= b.min && um < b.max) || DEFAULT_BANDS[DEFAULT_BANDS.length - 1]).color;

/* ---------- shell: Clarity + Pages ---------- */
initClarity();
const toggler = (popId, btnId) => (e) => { e.stopPropagation(); $(popId).hidden ? showPop($(popId), $(btnId)) : closePop(); };
$('clarityBtn').onclick = toggler('clarity', 'clarityBtn');
$('pagesBtn').onclick = toggler('pagesPop', 'pagesBtn');
document.addEventListener('click', (e) => { const p = document.querySelector('.pop:not([hidden])'); if (p && !p.contains(e.target)) closePop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(true); });

/* ---------- table cells (spec-proof-flags.md 1a: one number per cell, one sentence) ---------- */
// A number cell: value in --font-num, unit muted, optional source line under it.
const numCell = (val, unit, src = '') => `<span class="pf-n"><span class="pf-v">${val}</span><span class="pf-u">${unit}</span></span>${src ? `<small class="pf-src">${src}</small>` : ''}`;
const NA = (why) => `<span class="pf-n"><span class="pf-v pf-na" title="${esc(why)}" aria-hidden="true">—</span></span><span class="sr-only">${esc(why)}</span>`;
function expectedCell(t) {
  const x = t.expected;
  if (t.type === 'motion') return numCell(arcs(x.value), '″/yr', esc(shortSource(x.source)));
  return numCell('variable', '', esc(shortSource(x.source)));
}
let minYr = 0.7; // set from proof.json settings in render()
function measuredCell(t) {
  const m = t.measured;
  if (t.verdict === 'NOT MEASURABLE' || !m) return NA(`Not measurable: ${t.type === 'motion' ? nmReason(t, minYr) : 'see the details'}`);
  if (t.type === 'motion') {
    if (m.significant === false) return numCell(`&lt; ${arcs(m.upperLimit)}`, '″/yr');
    return numCell(`${arcs(m.value)} ± ${arcs(m.err)}`, '″/yr');
  }
  const g = mainGroup(t);
  if (!g) return NA('No usable change');
  // every measured wavelength group, the deciding one first (RW Aurigae: fainter at 3.8–5.0 µm, brighter at 0.75–3.8 µm)
  const all = [g, ...(t.measured?.groups || []).filter(x => x.ok && x.err > 0 && x !== g)];
  return all.map(x => `<span class="pf-grp" title="${esc(plainBand(x.name))}">${numCell(`${Math.abs(x.value).toFixed(2)} ± ${x.err.toFixed(2)}`, ` mag ${x.value > 0 ? 'fainter' : 'brighter'}${all.length > 1 ? ` at ${esc(plainBand(x.name))}` : ''}`)}</span>`).join('<br>');
}
function diffCell(t) {
  if (!t.diff) return DASH(t.verdict === 'NOT MEASURABLE' ? 'Nothing measured to compare' : 'No difference computed');
  if (t.type === 'motion') return numCell(sgn(t.diff.value / 1000), '″/yr')
    + `<small class="pf-src num">${t.diff.sigma}σ speed</small>`
    + (t.direction ? `<small class="pf-src num" title="Measured minus catalogue as an arrow: ${arcs(t.direction.value)}″/yr, χ ${t.direction.chi2d.toFixed(2)} over 2 degrees of freedom, the same chance as ${t.direction.sigma.toFixed(1)}σ in one dimension">${t.direction.sigma.toFixed(1)}σ direction</small>` : '');
  return t.measured.groups.map(g => `<small class="pf-src num" title="${esc(g.name)}: change ÷ uncertainty" aria-label="${esc(plainBand(g.name))}">${g.ok ? `${g.sigma}σ` : '—'}</small>`).join('');
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

/* ---------- the detail behind the chevron (spec 1c): six labelled groups, then the chart ---------- */
// A group: heading + label/value pairs. Pairs with an empty value are dropped; an empty group is left out.
const grp = (h, pairs) => {
  const p = pairs.filter(x => x && x[1] != null && x[1] !== '');
  return p.length ? `<section class="pf-g"><h4>${h}</h4><dl>${p.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></section>` : '';
};
const fitTxt = (x) => (x.ok ? `${arcs(x.total)} ± ${arcs(x.totalErr)}″/yr (${x.frames})` : `no fit (${esc(x.reason || 'no steady track')})`);
function groups(t, target) {
  const out = [], m = t.measured, c = t.counts, im = target.images;
  if (t.type === 'motion') {
    const w = t.window, fa = t.fitAnyway, v = t.variants || {};
    const ok = m && t.verdict !== 'NOT MEASURABLE';
    out.push(grp('Speed', [
      ok && ['measured', m.significant === false ? `no significant motion (&lt; ${arcs(m.upperLimit)}″/yr)` : `${arcs(m.value)} ± ${arcs(m.err)}″/yr`],
      ['catalogue', `${arcs(t.expected.value, t.expected.value < 1000 ? 3 : 2)}″/yr${t.expected.err != null ? ` ± ${t.expected.err} mas/yr` : ''}`],
      ['source', esc(t.expected.source)],
      t.diff && ['apart', `${t.diff.sigma}σ`],
      w && ['agrees from', `${arcs(w.lo)} to ${arcs(w.hi)}″/yr`],
      fa && ['the fit gives', `${arcs(fa.value)} ± ${arcs(fa.err)}″/yr from ${fa.frames} images, not claimed`],
      !ok && ['why not', `Not measurable: ${esc(nmReason(t, minYr))}`],
      v.all && ['all detectors', fitTxt(v.all)], v.short && ['detectors 1–4', fitTxt(v.short)], v.long && ['detectors 5–6', fitTxt(v.long)], v.filtersOn && ['flagged hidden', fitTxt(v.filtersOn)],
      ['expected shift', `${t.shiftPx} of a 6.15″ pixel`],
    ]));
    const d = t.direction;
    if (d) out.push(grp('Direction', [
      ['measured', `${d.measured}°`], ['catalogue', `${d.catalogue}°`],
      ['apart', `${Math.abs(d.paDiff).toFixed(1)}° (${d.sigma.toFixed(1)}σ)`],
      ['sideways', `about ${arcs(d.sideways, 1)}″/yr`],
      w?.paLo != null && ['agrees from', `${w.paLo}° to ${w.paHi}°`],
      ['difference', `${sgn(d.east / 1000)}″/yr east, ${sgn(d.north / 1000)}″/yr north; χ ${d.chi2d} over 2 degrees of freedom`],
    ]));
    else if (m && t.expected.pa != null) out.push(grp('Direction', [['measured', `${m.pa}°`], ['catalogue', `${t.expected.pa}°`], ['note', 'not judged: nothing measurable']]));
    const floor = (ok ? m : fa)?.floorText || '';
    const fm = floor.match(/^floor ([\d.]+″\/yr) from (.*?)(?: \((.*); (\d+) usable here\))?$/);
    out.push(grp('Error floor', fm ? [['floor', fm[1]], ['from', esc(fm[3] ? `${fm[2]}, ${fm[3]}` : fm[2])], fm[4] != null && ['usable here', fm[4]],
      ok && m.statErr != null && ['scatter part', `± ${arcs(m.statErr)}″/yr`], ok && ['combined', `± ${arcs(m.err)}″/yr`]] : [['floor', esc(floor)]]));
    out.push(grp('Images used', [
      ['images', ok ? `${m.frames}` : fa ? `${fa.frames}` : `${im.loaded}`],
      m && ['seasons', `${m.seasons.length}`], m && ['span', `${m.span} years`], m && ['bands', esc(m.bands)],
      m && ['dates', m.seasons.map(s => `${s.from} to ${s.to} (${s.n})`).join(' · ')],
      ['in the archive', `${im.loaded} loaded of ${im.archive}, ${im.first} to ${im.last}`],
    ]));
  } else {
    const gs = m?.groups || [];
    out.push(grp('Brightness change', [
      ['catalogue', esc(t.expected.text)], ['source', esc(t.expected.source)],
      ...gs.map(g => [esc(plainBand(g.name)), g.ok ? `${sgn(g.value)} ± ${g.err.toFixed(2)} mag (${g.sigma}σ, ${g.frames} images)` : 'too few usable images']),
    ]));
    out.push(grp('Images used', [
      m && ['images', `${m.frames}`],
      ...gs.filter(g => g.ok).map(g => [`${esc(plainBand(g.name))} by season`, g.seasons.map(s => `${s.from}: ${sgn(s.dm)}${s.sem != null ? ` ± ${s.sem.toFixed(2)}` : ''} (${s.n})`).join(' · ')]),
      ['in the archive', `${im.loaded} loaded of ${im.archive}, ${im.first} to ${im.last}`],
    ]));
  }
  const ex = target.extra || {};
  out.push(grp('Flags and saturation', [
    c && ['saturation flag', `${c.saturationFlag} of ${c.images}`],
    c?.blanked != null && ['centre blanked', `${c.blanked} of ${c.fitted}`],
    c && ['limit', `${Math.round(100 * c.limitFrac)}%`],
    !c && ['centre saturated', `${im.saturatedCore} of ${im.loaded}`],
    ['flag touches star', `${im.flaggedNearStar} of ${im.loaded}`],
    ex.neighbours?.length && ['Gaia within 15″', ex.neighbours.map(n => `G ${n.g} at ${n.sepArcsec}″`).join(', ')],
    ex.brightNeighbour && [esc(ex.brightNeighbour.name), `${ex.brightNeighbour.sepArcsec}″ away; the patch reaches ${ex.brightNeighbour.cutoutHalfArcsec}″`],
  ]));
  out.push(`<section class="pf-g pf-g-lim${t.limit.length > 300 ? ' pf-g-wide' : ''}"><h4>Honest limits</h4><p class="pf-lim-t">${esc(t.limit)}</p></section>`);
  return `<div class="pf-groups">${out.join('')}</div>`;
}
function evidence(t, target) {
  const chart = t.type === 'motion' ? motionChart(t, target) : brightnessChart(t, target);
  const title = t.type === 'motion' ? 'Position against date, with the fitted line' : 'Brightness against date, compared with the first season';
  return `${groups(t, target)}<div class="pf-ev"><div class="pf-stage">${chart ? `<p class="pf-cap">${title}</p>${chart}` : `<p class="pf-cap">No chart: nothing could be measured.</p>`}</div>
    <div class="pf-evside"><a class="key" href="${esc(target.viewer)}">Open in the viewer</a></div></div>`;
}

/* ---------- render ---------- */
function render(d) {
  minYr = Math.max(d.settings?.minMotionMasYr ?? 700, 3 * (d.settings?.sysFloorMasYr ?? 150)) / 1000; // data.js motionMeasurability's line
  const runDay = $('runDate'); if (runDay && d.generated) runDay.textContent = new Date(d.generated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  $('rules').innerHTML = [['Moves (proper motion): speed', d.rules.motion], ...(d.rules.direction ? [['Moves: direction', d.rules.direction]] : []), ['Changes brightness', d.rules.brightness, 'brightness']].map(([h, rs, type]) =>
    `<div><h3>${h}</h3><dl class="pf-rule">${rs.map(([v, txt]) => `<dt>${chip(v, null, type)}</dt><dd>${esc(txt)}</dd>`).join('')}</dl></div>`).join('')
    + `<p class="pf-rule-note">σ is the measurement's uncertainty, with the catalogue's added. For motion it is the scatter of the image positions plus a systematic floor in each direction: the field stars' own floor where 3 or more are usable in the patch, otherwise ${arcs(d.settings.sysFloorMasYr)}″/yr, measured on the field stars of all five patches together. Each row says which. A result that looks bad stays in the table with its reason.</p>`
    + `<p class="pf-rule-note pf-sigma-key"><b>Reading the σ on a badge:</b> on motion rows it is how far our measurement is from the catalogue (small is good: AGREES 0.3σ); on brightness rows it is how big the change is next to its noise (big means clear: CHANGE SEEN 11.2σ).</p>`;
  let rows = '', k = 0;
  const chev = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5L7.5 6 4 9.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  for (const target of d.targets) {
    rows += `<tbody class="pf-group" id="${esc(target.key)}">`; // proof.html#barnard (the viewer's 'How we know →')
    target.tests.forEach((t, i) => {
      const id = `ev${k++}`, kind = t.type === 'motion' ? 'moves' : 'brightness';
      const name = i === 0 ? `<b>${esc(target.label)}</b>` : `<b class="pf-rep">${esc(target.label)}</b>`;
      rows += `<tr class="pf-row${i ? ' pf-next' : ''}" data-ev="${id}">
        <td class="pf-obj"><button class="pf-open" type="button" aria-expanded="false" aria-controls="${id}">${chev}<span class="pf-nm">${name}<small>${kind}</small></span></button></td>
        <td class="pf-exp">${expectedCell(t)}</td>
        <td class="pf-meas">${measuredCell(t)}</td>
        <td class="pf-diff x-only">${diffCell(t)}</td>
        <td class="pf-ver">${chip(t.verdict, verdictSigma(t), t.type)}${t.direction ? chip(t.direction.verdict, t.direction.sigma) : ''}</td>
        <td class="pf-why"><p>${esc(whySentence(t, target, minYr))}</p></td>
        <td class="pf-more"><button class="pf-det" type="button" aria-expanded="false" aria-controls="${id}">Details ${chev}</button></td></tr>
        <tr class="drow pf-drow" id="${id}" hidden><td colspan="7">${evidence(t, target)}</td></tr>`;
    });
    rows += `</tbody>`;
  }
  const tb = $('rows'); tb.insertAdjacentHTML('beforebegin', rows); tb.remove();
  { const h = location.hash.slice(1), el = h && document.getElementById(decodeURIComponent(h)); if (el && el.classList.contains('pf-group')) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' })); }
  document.querySelectorAll('.pf-row').forEach(r => {
    const btns = r.querySelectorAll('.pf-open,.pf-det'), ev = document.getElementById(r.dataset.ev);
    const toggle = () => { const open = ev.hidden; ev.hidden = !open; btns.forEach(b => b.setAttribute('aria-expanded', String(open))); r.classList.toggle('pf-on', open); };
    btns.forEach(b => { b.onclick = (e) => { e.stopPropagation(); toggle(); }; });
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
    rd ? `Very bright stars saturate. R Draconis carries the archive's saturation flag at its centre in ${rd.images.saturatedCore} of ${rd.images.loaded} images (the motion rule's count), and every image has a masked pixel within 15″ (the brightness rule's count), so neither its motion nor its brightness can be read.` : null,
    `These are the viewer's ${d.settings.maxImages}-image measurement set per object, spread evenly in time, not every image in the archive; the viewer's movie may hold one band for viewing.`,
  ].filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('');
}

fetch('data/proof.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(render).catch(e => {
  console.error('Proof page:', e); // never swallow it (render() removes #rows before it can fail)
  const at = $('rows') || document.querySelector('.pf-table tbody') || document.querySelector('table');
  if (!at) return;
  at.innerHTML =`<tr><td colspan="7" class="empty">The measurements file could not be read (${esc(e.message)}). Run <span class="num">node tools/make_proof.mjs</span> with the server on, then reload.</td></tr>`;
});
