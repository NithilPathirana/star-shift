// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// "Measure it yourself" page (design/spec-team-extras.md item 1): a guided classroom activity on
// Barnard's Star. Images come through the viewer's own pipeline (data.js planImages / gridFor /
// loadFrame / buildStacks) with the viewer's settings, so the five demo targets answer from
// web/prebaked/ and the page works offline. Only the first and last seasons are loaded. The maths
// lives in ./logic.js (unit-tested in tests/measure.test.mjs). Nothing is stored or sent.

import { planImages, gridFor, loadFrame, buildStacks } from '../data.js';
import { mapLimit } from '../../core/irsa.js';
import { seasonBounds } from '../seasons.js';
import { PRESETS } from '../presets.js';
import { initClarity, showPop, closePop, esc, download } from '../archive/shell.js';
import '../expert.js'; // Simple / Expert: .x-only (expert detail) and .s-only (plain-words twin)
import { clickToGrid, speedOf, compareSpeed, compassWord, pixelWorth, TIER_WORDS, mjdDay, sheetMarkdown, fitFromProof, sq } from './logic.js';

const $ = (id) => document.getElementById(id);
const R = window.MockRender;
const BASE = location.origin;
const SETTINGS = Object.freeze({ fov: 2.5, max: 120, band: 'all' }); // the viewer's defaults (as Spot's LOAD_SETTINGS)
const PRESET = PRESETS.find(p => p.key === 'barnard');
const TARGET = { ...PRESET.target, presetKey: PRESET.key }; // as data.js resolveTarget builds it (same requests)
const ZOOM = 15; // the click pictures show the middle 15 × 15 pixels
const MARK = '#E8FF45', CAT = '#8BE9FF';
const twin = (s, x) => (s === x ? x : `<span class="s-only">${s}</span><span class="x-only">${x}</span>`);
const sgn = (v, d = 2) => { const t = Math.abs(v).toFixed(d); return (+t === 0 ? '' : v > 0 ? '+' : '−') + t; }; // exact 0: no sign
const dayOf = (d) => (d instanceof Date ? d : new Date(d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const longDay = (mjd) => dayOf(new Date((mjd - 40587) * 86400000));
const isoDay = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);

/* ---------- shell: Clarity + Pages ---------- */
initClarity();
const toggler = (popId, btnId) => (e) => { e.stopPropagation(); $(popId).hidden ? showPop($(popId), $(btnId)) : closePop(); };
$('clarityBtn').onclick = toggler('clarity', 'clarityBtn');
$('pagesBtn').onclick = toggler('pagesPop', 'pagesBtn');
document.addEventListener('click', (e) => { for (const id of ['clarity', 'pagesPop']) { const p = $(id); if (!p.hidden && !p.contains(e.target) && !e.target.closest('#clarityBtn, #pagesBtn')) closePop(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(true); });

// The viewer's stretch and colour scale (shared Clarity storage; defaults as in ui.js and Spot).
function viewSettings() {
  let s = {}; try { s = JSON.parse(localStorage.getItem('tgi-clarity-v1')) || {}; } catch { /* private mode */ }
  return { str: s.str || 'auto', ramp: s.ramp || 'copper' };
}

const S = { grid: null, stacks: [], crops: [], origin: 0, clicks: [null, null], show: 0, timer: null, hint: false, fit: null, gaia: null, ready: false };

/* ---------- loading: the viewer's pipeline, first and last seasons only ---------- */
async function load() {
  S.ready = false; $('status').hidden = false;
  $('status').textContent = "Loading the saved SPHEREx images of Barnard's Star…";
  try {
    const proofP = fetch('data/proof.json').then(r => r.json()).catch(() => null);
    const { chosen } = await planImages(TARGET, SETTINGS, { base: BASE });
    const bounds = seasonBounds(chosen.map(im => im.mjdStart));
    if (bounds.length < 2) throw new Error('only one season of images');
    const ends = [bounds[0], bounds[bounds.length - 1]];
    const want = chosen.filter(im => ends.some(b => im.mjdStart >= b.startMjd - 1e-6 && im.mjdStart <= b.endMjd + 1e-6));
    S.grid = gridFor(TARGET, chosen, SETTINGS.fov); // the viewer's grid: all 120 images' dates
    const frames = []; let failed = 0;
    await mapLimit(want, 8, async (im) => {
      try { frames.push(await loadFrame(im, TARGET, S.grid, SETTINGS, { base: BASE })); } catch { failed++; }
      $('status').textContent = `Loading the saved SPHEREx images of Barnard's Star: ${frames.length + failed} of ${want.length}…`;
    });
    frames.sort((a, b) => a.mjd - b.mjd);
    const st = buildStacks(frames, bounds);
    if (st.length < 2) throw new Error('too few images arrived');
    S.stacks = [st[0], st[st.length - 1]];
    S.origin = Math.round(S.grid.c) - (ZOOM - 1) / 2;
    S.full = S.stacks.map(s => ({ d: Array.from(s.data, v => (Number.isFinite(v) ? v : null)) }));
    S.crops = S.stacks.map(s => crop(s.data, S.grid.n, S.origin, ZOOM));
    const ref = fitFromProof(await proofP, PRESET.key);
    S.fit = ref.fit; S.gaia = ref.gaia;
    S.ready = true;
    $('status').textContent = failed ? `${failed} images could not be read; the pictures use the other ${frames.length}.` : '';
    $('status').hidden = !failed;
    $('blinkBtn').disabled = false;
    $('scaleTxt').textContent = `${S.grid.scale.toFixed(2)}″`;
    const [a, b] = S.stacks;
    $('seasonNote').innerHTML = `First season: ${dayOf(a.startDate)} to ${dayOf(a.endDate)}, ${a.count} images.<br>Last season: ${dayOf(b.startDate)} to ${dayOf(b.endDate)}, ${b.count} images.`;
    $('capA').textContent = `${dayOf(a.startDate)} to ${dayOf(a.endDate)}`;
    $('capB').textContent = `${dayOf(b.startDate)} to ${dayOf(b.endDate)}`;
    for (const [k, id] of [[0, 'cvA'], [1, 'cvB']]) { // the catalogue's spot (for the hint ring and the page check)
      const e = S.stacks[k].expected; if (e) { $(id).dataset.catX = (e[0] - S.origin).toFixed(3); $(id).dataset.catY = (e[1] - S.origin).toFixed(3); }
    }
    document.body.dataset.measureReady = 'true';
    drawAll(); update();
  } catch (e) {
    $('status').hidden = false;
    $('status').innerHTML = `The saved images could not be loaded (${esc(e.message || e)}). <button class="key" id="retryBtn" type="button">Try again</button>`;
    $('retryBtn').onclick = load;
  }
}
function crop(data, n, o, m) {
  const d = new Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) { const v = data[(j + o) * n + (i + o)]; d[j * m + i] = Number.isFinite(v) ? v : null; }
  return { d };
}

/* ---------- drawing ---------- */
function cellFor(cv, n) { return Math.max(2, Math.round((cv.clientWidth || 300) * Math.min(3, devicePixelRatio || 1) / n)); }
function drawBlink() {
  const cv = $('cvBlink'), n = S.grid.n, vs = viewSettings(), s = S.stacks[S.show];
  R.draw(cv, S.full[S.show], n, { ramp: vs.ramp, cell: cellFor(cv, n), ring: false, stretch: vs.str });
  const lab = S.show ? 'Last season' : 'First season';
  $('blinkCap').textContent = `${lab} · ${dayOf(s.startDate)} to ${dayOf(s.endDate)}`;
  cv.setAttribute('aria-label', `${lab} of Barnard's Star, stacked from ${s.count} SPHEREx images taken ${dayOf(s.startDate)} to ${dayOf(s.endDate)}. The star is the bright spot in the middle.`);
  $('showA').setAttribute('aria-pressed', String(S.show === 0)); $('showB').setAttribute('aria-pressed', String(S.show === 1));
}
function cross(c, x, y, k, colour) {
  const g = Math.max(3, k * 0.18), L = Math.max(6, k * 0.55);
  c.save(); c.lineCap = 'round';
  for (const [w, col] of [[Math.max(3, k / 6), 'rgba(5,11,26,.85)'], [Math.max(1.5, k / 14), colour]]) {
    c.lineWidth = w; c.strokeStyle = col; c.beginPath();
    c.moveTo(x - g - L, y); c.lineTo(x - g, y); c.moveTo(x + g, y); c.lineTo(x + g + L, y);
    c.moveTo(x, y - g - L); c.lineTo(x, y - g); c.moveTo(x, y + g); c.lineTo(x, y + g + L); c.stroke();
  }
  c.restore();
}
function ring(c, x, y, r, colour, dash, w) {
  c.save(); c.lineWidth = w; c.strokeStyle = colour; c.setLineDash(dash);
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke(); c.restore();
}
function drawClick(k) {
  const cv = $(k ? 'cvB' : 'cvA'), vs = viewSettings(), cell = cellFor(cv, ZOOM);
  R.draw(cv, S.crops[k], ZOOM, { ramp: vs.ramp, cell, ring: false, stretch: vs.str });
  const c = cv.getContext('2d'), P = (g) => (g - S.origin + 0.5) * cell;
  if (S.hint && S.stacks[k].expected) { const [ex, ey] = S.stacks[k].expected; ring(c, P(ex), P(ey), cell * 1.4, CAT, [cell * 0.15, cell * 0.2], Math.max(1.5, cell / 12)); }
  const other = S.clicks[1 - k], mine = S.clicks[k];
  if (other) ring(c, P(other.x), P(other.y), cell * 0.55, 'rgba(255,255,255,.85)', [cell * 0.2, cell * 0.15], Math.max(1.5, cell / 14));
  if (mine) cross(c, P(mine.x), P(mine.y), cell, MARK);
}
function drawAll() { if (!S.ready) return; drawBlink(); drawClick(0); drawClick(1); }
new ResizeObserver(() => drawAll()).observe($('main'));

/* ---------- step 1: blink ---------- */
const reduce = () => document.documentElement.dataset.motion === 'reduce';
function startBlink() { stopBlink(); S.timer = setInterval(() => { S.show ^= 1; drawBlink(); }, reduce() ? 1500 : 700); $('blinkBtn').textContent = 'Stop blinking'; $('blinkBtn').setAttribute('aria-pressed', 'true'); }
function stopBlink() { clearInterval(S.timer); S.timer = null; $('blinkBtn').textContent = 'Blink'; $('blinkBtn').setAttribute('aria-pressed', 'false'); }
$('blinkBtn').onclick = () => (S.timer ? stopBlink() : S.ready && startBlink());
$('showA').onclick = () => { stopBlink(); S.show = 0; S.ready && drawBlink(); };
$('showB').onclick = () => { stopBlink(); S.show = 1; S.ready && drawBlink(); };

/* ---------- step 2: clicks (mouse, touch and keyboard) ---------- */
function place(k, x, y) {
  const lim = (v) => Math.min(S.origin + ZOOM - 0.5, Math.max(S.origin - 0.5, v));
  S.clicks[k] = { x: +lim(x).toFixed(2), y: +lim(y).toFixed(2) };
  drawClick(0); drawClick(1); update();
}
for (const [k, id] of [[0, 'cvA'], [1, 'cvB']]) {
  const cv = $(id);
  cv.addEventListener('click', (e) => {
    if (!S.ready) return;
    const g = clickToGrid(e.clientX, e.clientY, cv.getBoundingClientRect(), ZOOM);
    place(k, g.x + S.origin, g.y + S.origin);
  });
  cv.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || !S.ready) return;
    e.preventDefault();
    const step = e.shiftKey ? 1 : 0.1, p = S.clicks[k] || { x: S.grid.c, y: S.grid.c };
    place(k, p.x + d[0] * step, p.y + d[1] * step);
  });
}
$('clearBtn').onclick = () => { S.clicks = [null, null]; drawAll(); update(); };
$('hintBtn').onclick = () => { S.hint = !S.hint; $('hintBtn').setAttribute('aria-pressed', String(S.hint)); $('hintNote').hidden = !S.hint; drawAll(); };

/* ---------- steps 3-5: the maths, shown as it is worked out ---------- */
function result() {
  const [a, b] = S.clicks;
  if (!S.ready || !a || !b) return null;
  return speedOf(a, b, S.stacks[0].mjd, S.stacks[1].mjd, S.grid.scale);
}
function update() {
  const [a, b] = S.clicks, posTxt = (p) => (p ? `x ${(p.x - S.origin).toFixed(2)}, y ${(p.y - S.origin).toFixed(2)} px` : 'No click yet');
  $('posA').textContent = posTxt(a); $('posB').textContent = posTxt(b);
  const r = result();
  const scale = S.grid?.scale ?? 6.15;
  if (!r) {
    $('calc3').textContent = a || b ? `Now click the star in the ${a ? 'last' : 'first'} season picture.` : 'Click the star in both pictures first.';
    $('calc4').textContent = 'Waiting for step 3.';
    $('calc5').innerHTML = S.fit ? `Our fit: <b>${S.fit.value.toFixed(2)}″ a year</b>${twin('', ` ± ${S.fit.err.toFixed(2)}″/yr (1σ)`)}. Gaia: <b>${S.gaia?.toFixed(2) ?? '—'}″ a year</b>.` : 'Waiting for your speed.';
    $('result').hidden = true;
    return r;
  }
  const way = compassWord(r.pa);
  $('calc3').innerHTML = `<p>Across: Δx = ${sgn(r.dx)} px. Up and down: Δy = ${sgn(r.dy)} px.</p>`
    + `<p>Shift = √(Δx² + Δy²) = √(${sq(r.dx)} + ${sq(r.dy)}) = <b>${r.px.toFixed(2)} pixels</b></p>`
    + `<p>${r.px.toFixed(2)} pixels × ${scale.toFixed(2)}″ per pixel = <b>${r.arcsec.toFixed(1)}″</b>${way ? `, towards the ${way}` : ''}.</p>`
    + `<p class="x-only">East ${sgn(r.east, 1)}″, north ${sgn(r.north, 1)}″; position angle ${r.pa?.toFixed(0) ?? '—'}° east of north.</p>`;
  const [s0, s1] = S.stacks;
  $('calc4').innerHTML = `<p>Average date of the first season's images: ${longDay(s0.mjd)}. Of the last season's: ${longDay(s1.mjd)}.</p>`
    + `<p>Time between them: ${Math.abs(s1.mjd - s0.mjd).toFixed(0)} days ÷ 365.25 = <b>${r.years.toFixed(3)} years</b>${twin('', ` (MJD ${s0.mjd.toFixed(2)} → ${s1.mjd.toFixed(2)})`)}.</p>`
    + `<p>Your speed = ${r.arcsec.toFixed(1)}″ ÷ ${r.years.toFixed(3)} years = <b class="ms-big">${r.speed.toFixed(2)}″ a year</b></p>`
    + `<p class="ms-note">Both pictures are from the same time of year, so the small yearly wobble from Earth's orbit (parallax, 0.55″ for this star) almost cancels out.</p>`;
  const cmp = compareSpeed(r.speed, S.fit, S.gaia, { scale, years: r.years });
  $('calc5').innerHTML = S.fit
    ? `<p>You: <b>${r.speed.toFixed(2)}″ a year</b>. Our fit: <b>${S.fit.value.toFixed(2)} ± ${S.fit.err.toFixed(2)}″ a year</b> from all 120 images. Gaia: <b>${S.gaia?.toFixed(2) ?? '—'}″ a year</b>.</p>`
    : '<p>Our fit could not be loaded (web/data/proof.json), so there is nothing to compare with.</p>';
  const res = $('result');
  if (!cmp) { res.hidden = true; return r; }
  const w = TIER_WORDS[cmp.tier], worth = pixelWorth(scale, r.years);
  res.className = `ms-result ms-${cmp.tier}`;
  res.innerHTML = `<p class="ms-head">${esc(w.head)}</p><p>${esc(w.body)}</p>`
    + `<p>You are ${Math.abs(cmp.diff).toFixed(2)}″ a year ${cmp.diff >= 0 ? 'faster' : 'slower'} than our fit. The fit's own uncertainty is ${S.fit.err.toFixed(2)}″ a year, so you are <b>${cmp.sigmas.toFixed(1)} times</b> that away${twin('', ` (Δ = ${sgn(cmp.diff)}″/yr = ${cmp.sigmas.toFixed(1)}σ<sub>fit</sub>)`)}.</p>`
    + (cmp.gaiaPct != null ? `<p>Compared with Gaia you are ${cmp.gaiaPct.toFixed(cmp.gaiaPct < 10 ? 1 : 0)}% ${cmp.gaiaDiff >= 0 ? 'high' : 'low'}.</p>` : '')
    + `<p>Why it is hard: here one pixel of clicking error changes the answer by ${worth.toFixed(1)}″ a year, so your gap is about ${cmp.pxOff.toFixed(2)} of a pixel. If each of your clicks is good to about a quarter of a pixel, your own answer is only good to about ±${cmp.yourErr.toFixed(1)}″ a year${twin('', ` (√2 × 0.25 px × ${worth.toFixed(2)}″/yr per px)`)}. The computer found the star's centre in each of 120 images to a small fraction of a pixel; you used two pictures and your eyes.</p>`
    + `<p><button class="key" type="button" id="againBtn">Try again</button></p>`;
  res.hidden = false;
  $('againBtn').onclick = () => { S.clicks = [null, null]; drawAll(); update(); $('cvA').focus(); };
  return r;
}

/* ---------- the teacher's sheet: print, or a Markdown file ---------- */
function sheetData() {
  const r = result(), day = (m) => (Number.isFinite(m) ? mjdDay(m) : null);
  const [s0, s1] = S.stacks;
  return {
    star: "Barnard's Star", scale: S.grid?.scale ?? 6.15,
    first: s0 ? { from: isoDay(s0.startDate), to: isoDay(s0.endDate), mid: day(s0.mjd) } : null, last: s1 ? { from: isoDay(s1.startDate), to: isoDay(s1.endDate), mid: day(s1.mjd) } : null,
    a: S.clicks[0] && { x: S.clicks[0].x - S.origin, y: S.clicks[0].y - S.origin }, b: S.clicks[1] && { x: S.clicks[1].x - S.origin, y: S.clicks[1].y - S.origin },
    result: r, cmp: r ? compareSpeed(r.speed, S.fit, S.gaia, { scale: S.grid.scale, years: r.years }) : null, fit: S.fit, gaia: S.gaia,
  };
}
$('printBtn').onclick = () => { stopBlink(); window.print(); };
$('mdBtn').onclick = () => download('star-shift-measure-barnards-star.md', sheetMarkdown(sheetData()), 'text/markdown');

load();
