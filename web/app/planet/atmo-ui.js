// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// "What gets through the air" panel (DESIGN.md 31b) on the "Can I see it tonight?" page.
// One row per place (the chosen place first, then Mauna Kea, Paranal, Kitt Peak, Colombo) and
// a last row for SPHEREx in space. Shading comes from real ATRAN curves (atmo.js, README in
// web/data/atran/). Nothing here is sent anywhere: the place stays in this page's memory.
import { observer, bodies, starAltAz } from './astro.js';
import { DEFAULT_BANDS } from '../bands.js';
import { RULER, RULE_TEXT, COMPARE_SITES, curveForPlace, bandMean, verdict, rulerSegments, targetLine, coverage, darkRanges, fmtRanges } from './atmo.js';

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (um) => ((um - RULER.min) / (RULER.max - RULER.min) * 100);
const fmtM = (m) => `${Math.round(m).toLocaleString('en-GB')} m`;
const dash = (why) => `<span class="pl-miss" title="${esc(why)}" tabindex="0">—<span class="sr-only"> (${esc(why)})</span></span>`;

let data = null, failed = false, el = null, lastKey = '', lastT = 0, timer = 0, pending = null;

export async function initAir(root) {
  el = root; if (!el) return;
  el.querySelector('#airRule').textContent = RULE_TEXT;
  try {
    const res = await fetch(new URL('../../data/atran/transmission.json', import.meta.url));
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch { failed = true; }
  lastKey = '';
  if (pending) updateAir(pending, true);
  else if (failed) el.querySelector('#airRows').innerHTML = '<p class="note">The transmission curves could not be loaded, so this panel cannot be shown.</p>';
}

// Called on every sky recompute; does real work at most about once a second.
export function updateAir(state, force = false) {
  pending = state; if (!el || (!data && !failed)) return;
  const now = performance.now(), key = state.place.id + '|' + state.place.lat + '|' + state.place.lon;
  if (!force && key === lastKey && now - lastT < 1000) { clearTimeout(timer); timer = setTimeout(() => updateAir(pending, true), 1000); return; }
  lastT = now;
  clearTimeout(timer);
  if (failed) return;
  if (key !== lastKey) { lastKey = key; renderRows(state.place); }
  renderTargets(state);
}

function placesFor(chosen) {
  const list = [{ ...chosen, chosen: true }];
  for (const s of COMPARE_SITES) {
    if (s.id === chosen.id || (Math.abs(s.lat - chosen.lat) < 0.01 && Math.abs(s.lon - chosen.lon) < 0.01)) continue;
    list.push(s);
  }
  return list;
}

function rulerHtml(segs, label) {
  // Blocked share drawn as the no-data hatch masked by a hard-stop gradient (1 − T as alpha).
  const stops = [];
  let gap = '';
  for (const s of segs) {
    const a = pct(s.from).toFixed(3), b = pct(s.to).toFixed(3);
    if (s.block == null) {
      stops.push(`rgba(0,0,0,0) ${a}%`, `rgba(0,0,0,0) ${b}%`);
      gap += `<span class="air-gap" style="left:${a}%;width:${(b - a).toFixed(3)}%" title="No curve: the source curves start at 0.90 µm" aria-hidden="true"></span>`;
    } else stops.push(`rgba(0,0,0,${s.block}) ${a}%`, `rgba(0,0,0,${s.block}) ${b}%`);
  }
  const m = segs.length ? `linear-gradient(to right,${stops.join(',')})` : 'none';
  const bars = DEFAULT_BANDS.map(b => `<i style="left:${pct(b.min)}%;width:${pct(b.max) - pct(b.min)}%;background:${b.color}"></i>`).join('');
  return `<div class="air-bandbar" aria-hidden="true">${bars}</div>
    <div class="air-ruler${segs.length ? '' : ' air-clear'}" role="img" aria-label="${esc(label)}"><span class="air-hatch" style="--m:${m}"></span>${gap}</div>
    <div class="scale-row air-scale" aria-hidden="true">${[1, 2, 3, 4, 5].map(u => `<i class="maj" style="left:${pct(u)}%"></i><span style="left:${pct(u)}%">${u} µm</span>`).join('')}${[1.5, 2.5, 3.5, 4.5].map(u => `<i style="left:${pct(u)}%"></i>`).join('')}</div>`;
}

function bandChips(curveRef) {
  return '<ul class="air-bands">' + DEFAULT_BANDS.map(b => {
    if (!curveRef) return `<li><button class="air-band" type="button" aria-label="${esc(b.name)}: no air in the way"><i style="background:${b.color}"></i><span class="bn">${esc(b.name)}</span></button></li>`;
    const m = bandMean(data, curveRef.curve, b.min, b.max);
    if (!m) return `<li><button class="air-band" type="button" aria-label="${esc(b.name)}: no curve"><i style="background:${b.color}"></i><span class="bn">${esc(b.name)}</span> ${dash('No transmission curve covers this band')}</button></li>`;
    const v0 = verdict(m.mean), p = Math.round(m.mean * 100), best = curveRef.bestCase;
    // best case (mountain curve for a low place): the number is an upper limit; only 'blocked' is certain
    const v = best && v0 !== 'blocked' ? 'atmost' : v0;
    const part = m.partial ? `<sup title="Only ${m.from.toFixed(2)}–${m.to.toFixed(2)} µm has a curve">†</sup>` : '';
    const name = v === 'blocked' ? `<s>${esc(b.name)}</s>` : esc(b.name);
    const word = v === 'open' || v === 'atmost' ? '' : ` <span class="st">${v}</span>`;
    const aria = `${b.name}: ${best ? 'at most ' : ''}${p}% gets through${m.partial ? ` (measured over ${m.from.toFixed(2)}–${m.to.toFixed(2)} µm only)` : ''}${v === 'atmost' ? ', best case' : ', ' + v}`;
    return `<li><button class="air-band is-${v}" type="button" aria-label="${esc(aria)}"><i style="background:${b.color}"></i><span class="bn">${name}</span> <span class="num">${best ? 'at most ' : ''}${p}%${part}</span>${word}</button></li>`;
  }).join('') + '</ul>';
}

function renderRows(chosen) {
  const rows = placesFor(chosen), methods = [];
  let h = '';
  rows.forEach((p, i) => {
    const ref = curveForPlace(p, data);
    if (!ref) return; // no curve for this place: leave the row out (DESIGN.md 31b)
    const segs = rulerSegments(data, ref.curve);
    const fmtM2 = (m) => `${Math.round(m).toLocaleString('en-GB')} m`;
    const short = ref.bestCase ? `Best case: this is a mountain curve from ${fmtM2(ref.curve.siteAltM)}. At sea level less gets through.`
      : ref.approximate ? `approximate · from ${ref.curve.site}, ${ref.curve.pwvMm} mm` : `own curve · ${ref.curve.pwvMm} mm water vapour`;
    const dark = fmtRanges(darkRanges(data, ref.curve));
    const known = Number.isFinite(p.elev) && !(p.id === 'coords' || p.id === 'me');
    const height = known ? fmtM(p.elev) : 'height not known';
    methods.push(`<li><b>${esc(p.name)}</b>: ${esc(ref.how)}.</li>`);
    h += `<div class="air-row" role="listitem" data-i="${i}">
      <div class="air-place"><b>${esc(p.name)}</b>${p.chosen ? '<span class="air-you">chosen place</span>' : ''}<span class="num">${height}</span><small${ref.bestCase ? ' class="air-best"' : ''}>${esc(short)}</small></div>
      <div class="air-mid">${bandChips(ref)}${rulerHtml(segs, `Air transmission from ${p.name}, 0.74 to 5.01 micrometres`)}<p class="air-dark num">Dark from here${ref.bestCase ? ', even in this best case' : ''}: ${esc(dark)}</p></div>
      <div class="air-target num" data-site="${i}"></div>
    </div>`;
  });
  h += `<div class="air-row air-space" role="listitem">
    <div class="air-place"><b>SPHEREx, in space</b><span class="num">in orbit, above the air</span><small>no air in the way</small></div>
    <div class="air-mid">${bandChips(null)}${rulerHtml([], 'No air in the way: clear from 0.74 to 5.01 micrometres')}<p class="air-dark air-cap num">Dark from here: nowhere</p></div>
    <div class="air-target air-na">No air, so no airmass</div>
  </div>`;
  el.querySelector('#airRows').innerHTML = h;
  el.querySelector('#airHow').innerHTML = methods.join('');
  el._rows = rows;
  el.querySelectorAll('.air-band').forEach(b => b.onclick = () => b.classList.toggle('show-name')); // phone: tap for the name
  const c = Object.values(data.curves)[0], [c0] = coverage(data, c);
  el.querySelector('#airGap').textContent = c0 > RULER.min ? `The curves start at ${c0.toFixed(2)} µm, so 0.74–${c0.toFixed(2)} µm has no data on the ground rows (the dotted strip at the left end); † marks a band measured over the covered part only.` : '';
}

function altFrom(site, sel, t, chosenSel) {
  if (site.chosen && Number.isFinite(chosenSel?.alt)) return chosenSel.alt; // already worked out by the sky
  const obs = observer(site.lat, site.lon, site.elev || 0);
  if (sel.kind === 'sun' || sel.kind === 'moon' || sel.kind === 'planet') return bodies(t, obs).find(b => b.key === sel.key)?.alt;
  return starAltAz(sel.ra, sel.dec, t, obs).alt;
}

function renderTargets({ sel, time }) {
  const rows = el._rows || [];
  el.querySelector('#airTarget').textContent = sel ? `${sel.name}, from each place now` : 'Pick something on the sky to see how high it is from each place now.';
  el.querySelectorAll('.air-target[data-site]').forEach(cell => {
    const site = rows[+cell.dataset.site];
    if (!sel) { cell.innerHTML = dash('Nothing picked on the sky yet'); return; }
    let alt = null; try { alt = altFrom(site, sel, time, sel); } catch { alt = null; }
    const line = targetLine(alt);
    cell.innerHTML = line ? esc(line) : dash('Could not be computed');
    cell.classList.toggle('air-down', !!line && alt <= 0);
  });
}
