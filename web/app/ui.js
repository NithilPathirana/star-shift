// Live site controller for DESIGN.md v2 (direction E). UI behaviours (Clarity, sound, popovers,
// timeline, band editor, tooltips, refraction, glare) follow the Design Studio prototype;
// data comes from the real pipeline (IRSA via our local relay, SIMBAD) and the sky map is
// Aladin Lite showing the SPHEREx DR1 all-sky map.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { parseQuery, QueryError, DEFAULT_SETTINGS } from './query.js';
import { run, buildStacks, measureMotion, resolveTarget } from './data.js';
import { kinematics, tangentialVelocity, toLSR } from './kinematics.js';
import { PRESETS, findPreset } from './presets.js';
import { toGalactic, toEcliptic, constellation, loadConstellations, visibleTonight, altAz, riseTransitSet } from './sky.js';
import { simbadCone, otypeName, CHANNEL_UM } from './skymap.js';
import { Sky3D as SkyMap } from './sky3d/index.js'; // 3D celestial sphere (three.js); same interface as the Aladin SkyMap
import { layersFor, DEFAULT_BANDS } from './bands.js';
import { listImages } from '../core/irsa.js';
import { propagate, separationArcsec, mjdToDate } from '../core/motion.js';
import { gridToWorld } from '../core/align.js';
import { createContam } from './contam-ui.js';
import { createGhost } from './ghost-ui.js';
import { createTelescopes } from './telescopes/index.js'; // Telescope compare (DESIGN.md 31a)

const R = window.MockRender;
const $ = id => document.getElementById(id), root = document.documentElement;
const mq = q => matchMedia(q).matches;
const BASE = location.origin;
const NOW_MJD = 61360; // mid-Nov 2026: where moving stars are "now" on the map
const SETTINGS = { ...DEFAULT_SETTINGS, fov: 2.5, max: 120, band: 'all' }; // 150″ cutouts (DESIGN.md)
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let tables = null;
// load() waits for the wavelength tables, so a deep link (?q=…&scene=viewer) never runs with tables = null
const tablesReady = fetch('core/data/spectral_wcs.json').then(r => r.json()).then(t => { tables = t; }).catch(() => {});
loadConstellations().then(() => { if (M.sel) renderCD(); }).catch(() => {}); // fill in the Constellation row once it can

/* ---------- Clarity settings (remembered, default from the OS) ---------- */
const KEY = 'tgi-clarity-v1';
const set = Object.assign({
  motion: mq('(prefers-reduced-motion: reduce)'), glass: mq('(prefers-reduced-transparency: reduce)'),
  contrast: mq('(prefers-contrast: more)'), text: false, sound: !mq('(prefers-reduced-motion: reduce)'),
  hatch: true, ring: true, str: 'auto', ramp: 'copper',
}, (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(set)); } catch { /* private mode */ } };
function applySettings() {
  root.dataset.motion = set.motion ? 'reduce' : 'full';
  root.dataset.glass = set.glass ? 'solid' : 'glass';
  root.dataset.contrast = set.contrast ? 'more' : 'normal';
  root.dataset.text = set.text ? 'large' : 'normal';
  document.querySelectorAll('[data-set]').forEach(b => b.setAttribute('aria-checked', !!set[b.dataset.set]));
  $('ringSw').setAttribute('aria-checked', set.ring); $('ringTool').setAttribute('aria-pressed', set.ring);
  $('flagsBtn').setAttribute('aria-pressed', set.hatch);
  segSelect($('strSeg'), b => b.dataset.str === set.str); segSelect($('rampSeg'), b => b.dataset.ramp === set.ramp);
  $('d-str').textContent = { auto: 'asinh 2–99.7%', linear: 'linear 2–99.7%', strong: 'asinh×30 5–99%' }[set.str];
  refraction(); requestAnimationFrame(layout);
}

/* ---------- sound: Web Audio, synthesised, quiet, ≤120 ms, throttled ---------- */
/* sounds v2 (DESIGN.md section 20): separate throttle clock per event group */
const Snd = { ctx: null, last: 0, clocks: {},
  wake() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ } } else if (this.ctx.state === 'suspended') this.ctx.resume(); },
  play(type) {
    if (!set.sound || !this.ctx) return; const now = performance.now();
    const group = /^zoom/.test(type) ? 'zoom' : type === 'scrub' ? 'scrub' : /^season/.test(type) ? 'season' : 'ui';
    const gap = { zoom: 150, scrub: 35, season: 250, ui: 45 }[group]; if (now - (this.clocks[group] || 0) < gap) return; this.clocks[group] = now;
    const c = this.ctx, t = c.currentTime;
    const tone = (f, at, dur, wave, peak) => { const o = c.createOscillator(), g = c.createGain(); o.type = wave; o.frequency.setValueAtTime(f, t + at);
      g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(peak, t + at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g).connect(c.destination); o.start(t + at); o.stop(t + at + dur + 0.02); };
    if (type === 'click') { tone(1700, 0, .035, 'triangle', .05); tone(850, 0, .045, 'sine', .03); }
    if (type === 'tick') tone(2400, 0, .025, 'sine', .04);
    if (type === 'detent') tone(1300, 0, .03, 'triangle', .055);
    if (type === 'confirm') { tone(660, 0, .06, 'sine', .055); tone(990, .055, .065, 'sine', .05); }
    if (type === 'error') { tone(240, 0, .07, 'triangle', .05); tone(190, .05, .07, 'triangle', .045); }
    if (type === 'zoomIn' || type === 'zoomOut') { // soft pitch glide + "air"
      const up = type === 'zoomIn', o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(up ? 420 : 680, t); o.frequency.exponentialRampToValueAtTime(up ? 680 : 420, t + .09);
      lp.type = 'lowpass'; lp.frequency.value = 1800; lp.Q.value = .7;
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.03, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + .1);
      o.connect(lp).connect(g).connect(c.destination); o.start(t); o.stop(t + .12);
      const len = Math.floor(c.sampleRate * .07), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const nz = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain(); nz.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = .8;
      ng.gain.setValueAtTime(.0001, t); ng.gain.exponentialRampToValueAtTime(.01, t + .01); ng.gain.exponentialRampToValueAtTime(.0001, t + .07);
      nz.connect(bp).connect(ng).connect(c.destination); nz.start(t); nz.stop(t + .08);
    }
    if (type === 'scrub') tone(3200, 0, .012, 'triangle', .018);
    if (type === 'season') { tone(880, 0, .055, 'sine', .04); tone(1320, .05, .065, 'sine', .04); }
    if (type === 'seasonSoft') { tone(880, 0, .055, 'sine', .02); tone(1320, .05, .065, 'sine', .02); }
  } };
addEventListener('pointerdown', () => Snd.wake(), { capture: true });
addEventListener('keydown', () => Snd.wake(), { capture: true });

function segSelect(seg, pred) {
  const btns = [...seg.querySelectorAll('.seg-btn')]; let idx = 0;
  btns.forEach((b, k) => { const on = pred(b); b.setAttribute('aria-pressed', on); if (on) idx = k; });
  // sized in % of the segment (not measured px), so it follows the control through any resize
  const th = seg.querySelector('.seg-thumb');
  th.style.width = `calc((100% - 6px) / ${btns.length})`; th.style.transform = `translateX(${idx * 100}%)`;
}
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); }

/* ======================= FLIP-BOOK (viewer scene) ======================= */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const V = { // current time-lapse
  query: null, target: null, grid: null, n: 25, raws: [], F: [], FA: [], /* FA = every frame, F = the ones the flag filter keeps */ stacks: [], planned: 0, plannedMjds: [], failed: 0, retries: 0,
  status: 'idle', ctl: null, motion: null, seasons: [], name: '',
};
const iso = d => d.toISOString().slice(0, 19);
const toF = f => ({ mjd: f.mjd, date: f.date, det: f.detector, um: f.wavelengthUm, exp: f.expected || [V.grid.c, V.grid.c],
  d: Array.from(f.data, v => (Number.isFinite(v) ? v : null)), obs: f.obsid, raw: f });
const stackToF = s => ({ mjd: s.mjd, date: `${iso(s.startDate)} to ${iso(s.endDate)}`, det: 'stack', um: null, exp: s.expected || [V.grid.c, V.grid.c],
  d: Array.from(s.data, v => (Number.isFinite(v) ? v : null)), count: s.count, start: s.startDate, end: s.endDate });
const seasonName = v => { const a = new Date(V.F[v.from].date.slice(0, 10)), b = new Date(V.F[v.to].date.slice(0, 10));
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) return `${MON[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  return `${MON[a.getUTCMonth()]}${a.getUTCFullYear() !== b.getUTCFullYear() ? ' ' + a.getUTCFullYear() : ''}–${MON[b.getUTCMonth()]} ${b.getUTCFullYear()}`; };
// observing seasons: SPHEREx revisits a spot about every 6 months; visits < 60 days apart are one season
const visits = (F) => { const out = []; let cur = null; F.forEach((f, i) => { if (!cur || f.mjd - F[i - 1].mjd > 60) { cur = { from: i, to: i }; out.push(cur); } else cur.to = i; }); return out; };
const seasonOf = i => V.seasons.findIndex(v => i >= v.from && i <= v.to);

/* timeline: seasons as raised segments, one tick per image (pending ones faint) */
let t0 = 0, t1 = 1;
const pos = m => (m - t0) / (t1 - t0) * 100;
const track = $('track');
let ticks = [];
function buildTimeline() {
  const F = V.F, all = V.plannedMjds.length ? V.plannedMjds : F.map(f => f.mjd);
  if (!all.length) { track.innerHTML = ''; $('tlLabels').innerHTML = ''; ticks = []; return; }
  t0 = Math.min(...all) - 5; t1 = Math.max(...all) + 5;
  V.seasons = F.length ? visits(F) : [];
  const pending = V.plannedMjds.filter(m => !V.FA.some(f => Math.abs(f.mjd - m) < 0.01));
  const hidden = V.FA.filter(f => !F.includes(f));
  track.innerHTML = V.seasons.map(v => `<div class="season" style="left:calc(${pos(F[v.from].mjd)}% - 8px);width:calc(${pos(F[v.to].mjd) - pos(F[v.from].mjd)}% + 16px)"></div>`).join('') +
    F.map(f => `<i class="tick" style="left:${pos(f.mjd)}%"></i>`).join('') +
    pending.map(m => `<i class="tick pending" style="left:${pos(m)}%"></i>`).join('') +
    hidden.map(f => `<i class="tick hid" style="left:${pos(f.mjd)}%" title="Hidden: ${esc(CX.whyHidden(f) || 'flag filter')}"></i>`).join('') + '<span class="key thumb" id="thumb"></span>';
  $('tlLabels').innerHTML = V.seasons.map(v => `<span style="left:${(pos(F[v.from].mjd) + pos(F[v.to].mjd)) / 2}%">${seasonName(v)}</span>`).join('');
  ticks = [...track.querySelectorAll('.tick:not(.pending):not(.hid)')];
  const g = document.createElement('span'); g.className = 'ghost'; g.innerHTML = '<b></b>'; track.appendChild(g);
  track.setAttribute('aria-valuemax', String(Math.max(1, F.length)));
  applyRanges();
}
let tlRaf = 0; const rebuildSoon = () => { if (!tlRaf) tlRaf = requestAnimationFrame(() => { tlRaf = 0; buildTimeline(); onFrame(P.i); }); };

let mode = 'play', side = 0, bt = null, zoom = 1, panX = 0, panY = 0, cssCell = 16, shown = -1;
function layout() {
  const box = $('screens'), two = mode === 'compare', n = V.n;
  const w = box.clientWidth, h = box.clientHeight - (two ? 28 : 0);
  const avail = two ? Math.min((w - 24) / 2, h) : Math.min(w, h);
  const fit = Math.max(3, Math.floor(avail / n));
  cssCell = fit * zoom;
  const dpr = devicePixelRatio || 1, dev = Math.max(1, Math.round(cssCell * dpr));
  for (const cv of [$('cvA'), $('cvB')]) { cv.style.width = cv.style.height = (n * cssCell) + 'px'; cv.dataset.dev = dev; }
  $('zlvl').textContent = zoom === 1 ? 'fit' : zoom + '×';
  $('screens').classList.toggle('pannable', zoom > 1);
  if (zoom === 1) { panX = panY = 0; }
  $('pan').style.transform = `translate(${panX}px,${panY}px)`;
  $('sbar').style.width = (cssCell * 30 / 6.15) + 'px';
  draw(); placeHits();
}
const opt = cv => ({ ramp: set.ramp, cell: +cv.dataset.dev, ring: set.ring && !!V.target, ringColor: getComputedStyle(root).getPropertyValue('--ring').trim(),
  maskBg: '#211b16', maskInk: '#6b5d50', stretch: set.str, hatch: set.hatch });
function cross(cv, fx, fy) {
  const c = cv.getContext('2d'), k = +cv.dataset.dev, x = (fx + .5) * k, y = (fy + .5) * k;
  c.strokeStyle = '#9DB89F'; c.lineWidth = Math.max(1.5, k / 10); c.beginPath();
  c.moveTo(x - 3.4 * k, y); c.lineTo(x - 1.2 * k, y); c.moveTo(x + 1.2 * k, y); c.lineTo(x + 3.4 * k, y);
  c.moveTo(x, y - 3.4 * k); c.lineTo(x, y - 1.2 * k); c.moveTo(x, y + 1.2 * k); c.lineTo(x, y + 3.4 * k); c.stroke();
}
const firstS = () => V.stacks[0], lastS = () => V.stacks[V.stacks.length - 1];
const sRange = s => `${R.fmtDate(iso(s.start))} – ${R.fmtDate(iso(s.end))}`;
function info(f, head) {
  $('ihead').textContent = head || 'This image';
  CX.info(f);
  if (!f) { ['d-date', 'd-time', 'd-det', 'd-um', 'd-mask', 'd-mjd'].forEach(id => { $(id).textContent = '—'; }); return; }
  const st = f.det === 'stack';
  $('d-date').textContent = st ? sRange(f) : R.fmtDate(f.date);
  $('d-time').textContent = st ? `season stack of ${f.count}` : f.date.slice(11, 16) + ' UTC';
  $('d-det').textContent = st ? 'mixed' : 'D' + f.det;
  $('d-um').textContent = f.um ? f.um.toFixed(2) + ' µm' : 'mixed, combined';
  const fl = CX.flaggedText(f);
  $('d-mask').textContent = fl ? fl.text : `${f.d.filter(v => v == null).length} of ${V.n * V.n}`; $('d-mask').title = fl ? fl.title : 'no-data pixels (stacked)';
  $('d-mjd').textContent = f.mjd ? f.mjd.toFixed(4) : '—';
}
function draw() {
  const A = $('cvA'), B = $('cvB'), F = V.F;
  $('ghostOff').hidden = true;
  if (mode === 'telescopes') { const f = F[Math.min(P.i, F.length - 1)]; TS.refresh(); TS.draw(); info(f || null); $('chip').innerHTML = CX.chipLead() + '<span>Telescopes · same patch, same scale, north up</span>'; return; }
  if (!F.length) { const c = A.getContext('2d'); c.clearRect(0, 0, A.width, A.height); info(null); $('chip').innerHTML = ''; return; }
  const ex = firstS()?.exp || F[0].exp;
  if (mode === 'play' || V.stacks.length < 2) {
    const f = F[Math.min(P.i, F.length - 1)]; CX.drawStage(A, f, V.n, opt(A), true); GH.drawCanvas(A, f, +A.dataset.dev); info(f);
    const rg = rangeOf(f.um);
    $('chip').title = rg?.tip ? `${rg.name}: ${rg.tip}` : '';
    $('chip').innerHTML = CX.chipLead() + `${rg ? `<i class="sw" style="--rc:${rg.c}"></i><span>${esc(rg.name)}</span><span class="sep">·</span>` : ''}<span>λ ${f.um ? f.um.toFixed(2) : '?'} µm</span><span class="sep">·</span><span>D${f.det}</span><span class="sep">·</span><span>${R.fmtDate(f.date)}</span>`;
    A.setAttribute('aria-label', `SPHEREx infrared image of ${V.name}, ${R.fmtDate(f.date)}, ${f.um ? f.um.toFixed(2) + ' micrometres' : ''}`);
  } else if (mode === 'compare') {
    CX.drawStage(A, firstS(), V.n, opt(A)); cross(A, ex[0], ex[1]); $('capA').innerHTML = `<b>First season</b> · stacked · ${sRange(firstS())}`;
    CX.drawStage(B, lastS(), V.n, opt(B)); cross(B, ex[0], ex[1]); $('capB').innerHTML = `<b>Last season</b> · stacked · ${sRange(lastS())}`;
    $('chip').innerHTML = CX.chipLead() + '<span>Cross = where the star was in the first season</span>'; info(lastS(), 'Right: last season');
  } else {
    const f = side ? lastS() : firstS(); CX.drawStage(A, f, V.n, opt(A)); cross(A, ex[0], ex[1]);
    $('flag').textContent = (side ? 'Last season · ' : 'First season · ') + sRange(f);
    $('chip').innerHTML = CX.chipLead() + '<span>Blink · stacked seasons</span>'; info(f, side ? 'Last season (stacked)' : 'First season (stacked)');
  }
}
let tickAnim = null;
function setCounter(i, animate) {
  const N = V.F.length, fmt = k => `${String(k + 1).padStart(2, '0')} / ${N}`;
  cancelAnimationFrame(tickAnim);
  if (!N) { $('counter').textContent = ''; return; }
  if (!animate || set.motion || Math.abs(i - shown) > 12 || shown < 0) { $('counter').textContent = fmt(i); shown = i; return; }
  let cur = shown; const dir = Math.sign(i - cur), stepA = () => { cur += dir; $('counter').textContent = fmt(cur); if (cur !== i) tickAnim = requestAnimationFrame(stepA); };
  shown = i; stepA();
}
function onFrame(i, manual) {
  const F = V.F;
  if (mode === 'play' || mode === 'telescopes') draw(); if (openPop?.pop.id === 'flagsPop' && !P.playing) CX.renderPop();
  GH.syncKey(); GH.update();
  if (!F.length) { setCounter(0); return; }
  i = Math.min(i, F.length - 1);
  const f = F[i];
  ticks.forEach((t, k) => t.classList.toggle('on', k === i));
  placeHits();
  const th = $('thumb'); if (th) th.style.left = pos(f.mjd) + '%';
  const s = seasonOf(i);
  if (!manual && P.playing && i > 0 && s !== seasonOf(i - 1)) Snd.play('seasonSoft');
  if (s >= 0) $('seasonLbl').innerHTML = `<b>Season ${s + 1}</b> of ${V.seasons.length} · ${seasonName(V.seasons[s])}`;
  $('tlDate').textContent = R.fmtDate(f.date);
  track.setAttribute('aria-valuenow', i + 1); track.setAttribute('aria-valuetext', `Image ${i + 1}, ${R.fmtDate(f.date)}`);
  setCounter(i, manual);
  $('play').dataset.playing = P.playing; $('play').setAttribute('aria-label', P.playing ? 'Pause' : 'Play');
  $('pi').innerHTML = P.playing ? '<path d="M5 4h3.5v12H5zM11.5 4H15v12h-3.5z" fill="currentColor"/>' : '<path d="M6 4l10 6-10 6z" fill="currentColor"/>';
  if (manual) $('live').textContent = `Image ${i + 1} of ${F.length}, ${R.fmtDate(f.date)}${f.um ? ', ' + f.um.toFixed(2) + ' micrometres' : ''}`;
}
const P = { i: 0, fps: 4, playing: false, timer: null,
  set(i, manual) { const n = V.F.length; if (!n) return; P.i = ((i % n) + n) % n; onFrame(P.i, manual); },
  play() { if (P.playing || V.F.length < 2) return; P.playing = true; const tick = () => { if (!P.playing) return; P.timer = setTimeout(() => { P.set(P.i + 1); tick(); }, 1000 / P.fps); }; tick(); onFrame(P.i); },
  pause() { P.playing = false; clearTimeout(P.timer); onFrame(P.i); },
  toggle() { P.playing ? P.pause() : P.play(); } };
// Contamination flags + Layers bar (DESIGN.md 23): contam-ui.js draws on the stage canvas.
const CX = createContam({ $, R, V, P, esc, set, Snd, base: BASE, tables: () => tables, rangeOf: um => rangeOf(um), segSelect,
  mode: () => mode, redraw: () => { draw(); }, refilter: () => refilter(), stackRaws: () => V.F.map(f => f.raw).sort((a, b) => a.mjd - b.mjd),
  closePop: () => closePop(), hideTip: () => hideTip(),
  tipAt: (html, x, y) => { clearTimeout(tipT); $('tip').innerHTML = html; placeTip({ left: x - 10, right: x + 10, top: y - 10, height: 20 }); } });
function restack() { V.stacks = V.F.length ? buildStacks(V.F.map(f => f.raw).sort((a, b) => a.mjd - b.mjd)).map(stackToF) : []; }
// Measure the motion from the images the flag filter keeps (also with no catalogue motion, e.g. a
// coordinate search). Runs when loading finishes and again whenever the filter changes.
function remeasure() {
  try { V.motion = V.grid && V.F.length ? measureMotion(V.F.map(f => f.raw), V.grid) : null; } catch { V.motion = null; }
  // only a final fit counts: all planned images tried and at least two observing seasons
  if (V.motion?.ok && visits(V.F).length < 2) V.motion = { ok: false, frames: V.motion.frames, reason: 'one season only' };
  $('d-meas').textContent = V.motion?.ok ? `${V.motion.significant === false ? `no significant motion (< ${(V.motion.upperLimit / 1000).toFixed(2)}″/yr)` : `${(V.motion.total / 1000).toFixed(2)} ± ${(V.motion.totalErr / 1000).toFixed(2)}″/yr`} (${V.FA.length > V.F.length ? 'flagged images hidden, ' : ''}${V.motion.frames} images)` : V.motion ? (V.motion.reason === 'one season only' ? 'needs two seasons to measure' : V.motion.reason === 'too few frames' ? 'too few images to measure' : 'too faint to measure') : '—';
  repaintMot?.();
}
// Re-apply the "hide images with…" filter, keeping the current image (or the nearest one in time).
function refilter() {
  const cur = V.F[P.i]; V.F = CX.filter(V.FA);
  if (cur && V.F.length) { let b = 0; V.F.forEach((f, k) => { if (Math.abs(f.mjd - cur.mjd) < Math.abs(V.F[b].mjd - cur.mjd)) b = k; }); P.i = b; } else P.i = 0;
  if (V.status === 'ready') { restack(); remeasure(); if (mode !== 'play' && mode !== 'telescopes' && V.stacks.length < 2) setMode('play'); }
  if (!V.F.length && V.FA.length) toast('Every image is hidden by the flag filter. Untick a box under FLAGS to bring them back.');
  buildTimeline(); // sets V.seasons for the count below
  $('d-n').textContent = `${V.F.length} shown of ${V.total}${V.FA.length > V.F.length ? ` · ${V.FA.length - V.F.length} hidden by flags` : ''} · ${V.seasons.length} season${V.seasons.length === 1 ? '' : 's'}`;
  onFrame(P.i);
}
function step(d) { if (mode !== 'play') setMode('play'); P.pause(); const before = seasonOf(P.i); P.set(P.i + d, true); Snd.play(seasonOf(P.i) !== before ? 'season' : 'scrub'); }

function setMode(m, withSound) {
  if (m === mode) return;
  if (m !== 'play' && m !== 'telescopes' && V.stacks.length < 2) { toast('Compare and Blink need two seasons of images.'); Snd.play('error'); return; }
  if (m === 'telescopes' && !V.grid) { toast('Telescopes needs a patch: pick one first.'); Snd.play('error'); return; }
  clearInterval(bt);
  const apply = () => {
    mode = m; const st = $('stage'); st.classList.remove('mode-play', 'mode-compare', 'mode-blink', 'mode-telescopes'); st.classList.add('mode-' + m); TS.show(m === 'telescopes');
    segSelect($('viewSeg'), b => b.dataset.mode === m);
    if (m !== 'play') P.pause();
    if (m === 'blink') { side = 0; bt = setInterval(() => { side ^= 1; draw(); }, set.motion ? 1500 : 600); }
    zoom = 1; layout(); onFrame(P.i);
  };
  if (withSound) Snd.play('tick');
  if (document.startViewTransition && !set.motion) document.startViewTransition(apply); else apply();
}
document.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => setMode(b.dataset.mode, true); });
document.querySelectorAll('[data-fps]').forEach(b => { b.onclick = () => { P.fps = +b.dataset.fps; segSelect($('speedSeg'), x => x === b); Snd.play('tick'); }; });
$('play').onclick = () => { if (mode !== 'play') setMode('play'); P.toggle(); Snd.play('click'); };
$('prev').onclick = () => step(-1); $('next').onclick = () => step(1);

let lastSeason = -1;
function scrub(x) {
  const F = V.F; if (!F.length) return;
  const r = track.getBoundingClientRect(), m = t0 + Math.min(1, Math.max(0, (x - r.left) / r.width)) * (t1 - t0);
  let b = 0; F.forEach((f, k) => { if (Math.abs(f.mjd - m) < Math.abs(F[b].mjd - m)) b = k; });
  if (b === P.i) return; const s = seasonOf(b); if (lastSeason >= 0 && s !== lastSeason) Snd.play('season'); else Snd.play('scrub'); lastSeason = s; P.set(b, true);
}
track.addEventListener('pointerdown', e => { if (mode !== 'play') setMode('play'); P.pause(); track.setPointerCapture(e.pointerId); track.classList.add('grab'); lastSeason = seasonOf(P.i); scrub(e.clientX); track.onpointermove = ev => scrub(ev.clientX); });
const endGrab = () => { track.onpointermove = null; track.classList.remove('grab'); };
track.addEventListener('pointermove', e => { // ghost tick with date pill under the pointer
  const g = track.querySelector('.ghost'), F = V.F; if (!g || !F.length) return;
  const r = track.getBoundingClientRect(), m = t0 + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (t1 - t0);
  let b = 0; F.forEach((f, k) => { if (Math.abs(f.mjd - m) < Math.abs(F[b].mjd - m)) b = k; });
  const f = F[b], rg = rangeOf(f.um); g.style.left = pos(f.mjd) + '%';
  g.firstChild.innerHTML = `${rg ? `<i style="--rc:${rg.c}"></i>` : ''}${R.fmtDate(f.date)}${f.um ? ` · λ ${f.um.toFixed(2)} µm` : ''}${rg ? ' · ' + esc(rg.name) : ''}`;
});
track.addEventListener('pointerup', endGrab); track.addEventListener('pointercancel', endGrab);
track.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); step(e.key === 'ArrowRight' ? 1 : -1); } });

$('zin').onclick = () => { if (scene === 'map') return mapZoom(1.6); zoom = Math.min(4, zoom + 1); layout(); Snd.play('zoomIn'); };
$('zout').onclick = () => { if (scene === 'map') return mapZoom(1 / 1.6); zoom = Math.max(1, zoom - 1); layout(); Snd.play('zoomOut'); };
$('zfit').onclick = () => { if (scene === 'map') return mapFit(); zoom = 1; layout(); Snd.play('click'); };
(() => { const sc = $('screens'); let sx, sy, ox, oy;
  sc.addEventListener('pointerdown', e => { if (zoom === 1) return; sc.setPointerCapture(e.pointerId); sc.classList.add('panning'); sx = e.clientX; sy = e.clientY; ox = panX; oy = panY;
    sc.onpointermove = ev => { const lim = V.n * cssCell / 2; panX = Math.max(-lim, Math.min(lim, ox + ev.clientX - sx)); panY = Math.max(-lim, Math.min(lim, oy + ev.clientY - sy)); $('pan').style.transform = `translate(${panX}px,${panY}px)`; }; });
  sc.addEventListener('pointerup', () => { sc.onpointermove = null; sc.classList.remove('panning'); }); })();

function toggleSet(k) { set[k] = !set[k]; save(); applySettings(); Snd.play('click'); }
document.querySelectorAll('[data-set]').forEach(b => { b.onclick = () => toggleSet(b.dataset.set); });
$('ringSw').onclick = () => toggleSet('ring'); $('ringTool').onclick = () => toggleSet('ring'); $('flagsBtn').onclick = () => toggleSet('hatch');
document.querySelectorAll('[data-str]').forEach(b => { b.onclick = () => { set.str = b.dataset.str; save(); applySettings(); Snd.play('tick'); }; });
document.querySelectorAll('[data-ramp]').forEach(b => { b.onclick = () => { set.ramp = b.dataset.ramp; save(); applySettings(); Snd.play('tick'); }; });

function copyText(btn, txt) {
  try { navigator.clipboard?.writeText(txt); } catch { /* ignore */ }
  btn.classList.add('done'); const l = btn.querySelector('.copy-l'); if (l) l.textContent = 'Copied'; Snd.play('confirm');
  setTimeout(() => { btn.classList.remove('done'); if (l) l.textContent = 'Copy coordinates'; }, 1600);
}
const coordStr = (ra, dec) => `${ra.toFixed(5)} ${dec >= 0 ? '+' : ''}${dec.toFixed(5)}`;
function curPos() { if (scene === 'viewer' && V.grid) return { ra: V.grid.ra0, dec: V.grid.dec0 }; return M.sel || (skymap.aladin ? skymap.center() : null); }
$('copyTop').onclick = e => { const p = curPos(); if (p) copyText(e.currentTarget, coordStr(p.ra, p.dec)); };
$('copyInsp').onclick = e => { const p = curPos(); if (p) copyText(e.currentTarget, coordStr(p.ra, p.dec)); };
function setCoordText(ra, dec) { $('coordTxt').textContent = `${R.fmtRA(ra)}  ${R.fmtDec(dec)}`; }

/* ---------- loading the time-lapse (real progress drives the rocket) ---------- */
function rocketAt(frac) {
  $('thinBar').style.transform = `scaleX(${frac})`; // the ScanLoader draws its own progress
}
/* loader v2 media + exit clip (DESIGN.md section 17; from design-v1.html) */
// Loader: Design Studio's code-based ScanLoader (design/loader/scan/), drawn from the real frames.
// 'astronaut' (Design Studio's video loop, v1.1; falls back to ScanLoader if the video can't play), 'scan' or 'sheet'
const LOADER = 'astronaut';
function leaveLoader() {
  const L = $('stLoading'); if (L.hidden || !V.scan) return 0;
  const scan = V.scan; V.scan = null; const ms = scan.done(); // AstroLoader returns its exit time; ScanLoader returns nothing
  const wait = set.motion ? 0 : (ms ?? 400);
  setTimeout(() => { L.hidden = true; scan.destroy(); }, wait);
  return wait; // callers start playback after this, so the first images aren't hidden behind the exit clip
}
// showState(null) leaves #stLoading alone so leaveLoader() can fade it out
function showState(id) { ['stLoading', 'stError', 'stEmpty'].forEach(x => { if (id === null && x === 'stLoading') return; $(x).hidden = x !== id; }); if (id && id !== 'stLoading') { V.scan?.destroy(); V.scan = null; } }
let arriveCount = 0;
function progress() {
  const done = V.F.length + V.failed, N = Math.max(1, V.planned);
  rocketAt(done / N);
  const slow = V.retries > 0 && V.status === 'loading';
  V.scan?.slow(slow ? `IRSA is slow. ${V.F.length} of ${V.planned} kept. Retrying ${V.retries} image${V.retries === 1 ? '' : 's'}` : null);
  if (V.status === 'loading') $('d-meas').textContent = `measuring… (${V.F.length} of ${V.planned || '…'} images)`;
}
function load(query, label) {
  V.ctl?.abort(); const ctl = V.ctl = new AbortController();
  P.pause(); clearInterval(bt); if (mode !== 'play') { mode = 'play'; $('stage').className = 'stage mode-play'; segSelect($('viewSeg'), b => b.dataset.mode === 'play'); }
  TS.show(false); TS.reset();
  CX.reset();
  Object.assign(V, { query, target: null, grid: null, raws: [], F: [], FA: [], stacks: [], planned: 0, plannedMjds: [], failed: 0, retries: 0, status: 'loading', motion: null, seasons: [], name: label || 'this patch' });
  P.i = 0; shown = -1; arriveCount = 0;
  $('stLoading').classList.remove('leaving');
  V.scan?.destroy();
  // Reduce motion -> the scan loader (DESIGN.md 17b); otherwise the astronaut video (it falls back to ScanLoader itself)
  V.scan = (LOADER === 'astronaut' && !set.motion && window.AstroLoader ? window.AstroLoader : window.ScanLoader)($('scanLoader'), {
    mode: LOADER, base: '/loader/v1.1/', target: V.name, bands: ranges, reducedMotion: set.motion,
    onStart: () => { Snd.play('click'); $('thin').hidden = false; const w = leaveLoader(); if (!set.motion) setTimeout(() => P.play(), w); },
    onRetry: () => { Snd.play('click'); if (V.query) load(V.query, V.name); },
  });
  showState('stLoading'); $('thin').hidden = true; buildTimeline(); progress(); draw(); onFrame(0);
  const emit = (e) => {
    if (ctl.signal.aborted) return;
    if (e.type === 'RESOLVED') { V.target = e.target; GH.forTarget(e.target); V.name = label || e.target.name || 'this patch'; V.scan?.set({ target: V.name }); }
    else if (e.type === 'PLANNED') {
      V.grid = e.plan.grid; V.n = V.grid.n; V.planned = e.plan.planned; V.plannedMjds = e.plan.mjds || [];
      V.total = e.plan.total;
      V.scan?.set({ total: V.planned, plan: V.plannedMjds.map(mjd => ({ mjd })) });
      if (!V.planned) { V.status = 'empty'; showState('stEmpty'); return; }
      $('tName').textContent = V.name; $('ra').textContent = R.fmtRA(V.grid.ra0); $('dec').textContent = R.fmtDec(V.grid.dec0); setCoordText(V.grid.ra0, V.grid.dec0);
      $('d-field').textContent = `${Math.round(V.n * V.grid.scale)}″ · north up`;
      layout(); buildTimeline(); progress();
    } else if (e.type === 'FRAME') {
      const f = toF(e.frame); V.raws.push(e.frame);
      let k = V.FA.findIndex(x => x.mjd > f.mjd); if (k < 0) k = V.FA.length; V.FA.splice(k, 0, f);
      V.scan?.add(f);
      const keep = V.F[P.i]; V.F = CX.filter(V.FA); if (keep) P.i = Math.max(0, V.F.indexOf(keep));
      CX.ensureLayers();
      progress(); rebuildSoon();
    } else if (e.type === 'FRAME_FAILED') { V.failed++; progress(); }
    else if (e.type === 'RETRY_WAIT') { V.retries++; progress(); }
    else if (e.type === 'DONE') {
      V.status = 'ready'; $('thin').hidden = true; const leaveWait = leaveLoader();
      if (!V.FA.length) { V.status = 'error'; $('errTxt').textContent = 'No images arrived. The archive is often busy; Retry asks again.'; $('useLoaded').hidden = true; showState('stError'); Snd.play('error'); return; }
      showState(null);
      restack(); // seasons stacked from the images the flag filter keeps
      remeasure();
      buildTimeline(); findOther(); // buildTimeline sets V.seasons for the count below
      $('d-n').textContent = `${V.F.length} shown of ${V.total}${V.FA.length > V.F.length ? ` · ${V.FA.length - V.F.length} hidden by flags` : ''} · ${V.seasons.length} season${V.seasons.length === 1 ? '' : 's'}`;
      onFrame(P.i); Snd.play('confirm');
      toast(V.failed ? `${V.F.length} images are in. ${V.failed} couldn't be fetched (IRSA busy); Retry later fills them.` : `All ${V.F.length} images are in.`);
      setTimeout(() => { if (!set.motion && !P.playing) P.play(); }, leaveWait);
    } else if (e.type === 'ERROR' || e.type === 'NOT_FOUND') {
      V.status = 'error'; $('thin').hidden = true;
      $('errTxt').textContent = e.message + (V.F.length ? ` ${V.F.length} images arrived and are kept.` : '');
      $('retry').hidden = e.type === 'NOT_FOUND'; $('useLoaded').hidden = !V.F.length;
      showState('stError'); Snd.play('error');
    }
  };
  tablesReady.then(() => { if (!ctl.signal.aborted) run(query, SETTINGS, { base: BASE, signal: ctl.signal, tables, emit }); });
}
$('retry').onclick = () => { Snd.play('click'); if (V.query) load(V.query, V.name); };
$('useLoaded').onclick = () => { showState(null); Snd.play('click'); };

/* ---------- popovers + sheets ---------- */
let openPop = null;
function showPop(pop, btn) {
  closePop(); const r = btn.getBoundingClientRect(); pop.hidden = false;
  pop.style.top = Math.min(r.bottom + 10, innerHeight - 120) + 'px'; pop.style.right = Math.max(12, innerWidth - r.right) + 'px'; pop.style.left = 'auto';
  requestAnimationFrame(() => { pop.classList.add('open'); applySettings(); });
  btn.setAttribute('aria-expanded', 'true'); openPop = { pop, btn }; Snd.play('tick');
  setTimeout(() => (pop.querySelector('button') || pop).focus(), 30);
}
function closePop() { if (!openPop) return; const { pop, btn } = openPop; pop.classList.remove('open'); btn.setAttribute('aria-expanded', 'false');
  setTimeout(() => { if (!pop.classList.contains('open')) pop.hidden = true; }, 220); openPop = null; }
$('clarityBtn').onclick = e => { e.stopPropagation(); openPop?.pop.id === 'clarity' ? closePop() : showPop($('clarity'), $('clarityBtn')); };
$('helpBtn').onclick = e => { e.stopPropagation(); openPop?.pop.id === 'help' ? closePop() : showPop($('help'), $('helpBtn')); };
$('flagsMore').onclick = e => { e.stopPropagation(); if (openPop?.pop.id === 'flagsPop') return closePop(); CX.renderPop(); showPop($('flagsPop'), $('flagsMore'));
  placeFlagsPop(); };
// Flag legend: inside the stage, at most min(520 px, stage height − 16 px) tall (it scrolls inside),
// anchored by its bottom so opening the "Hide images" section grows it upwards.
function placeFlagsPop() {
  const r = $('flagsMore').getBoundingClientRect(), st = $('stage').getBoundingClientRect(), p = $('flagsPop');
  p.style.maxHeight = Math.max(160, Math.min(520, st.height - 16)) + 'px';
  p.style.top = 'auto'; p.style.bottom = (innerHeight - Math.min(r.top - 10, st.bottom - 8)) + 'px';
  p.style.right = Math.max(innerWidth - st.right + 8, innerWidth - r.right, 8) + 'px';
}
addEventListener('resize', () => { if (openPop?.pop.id === 'flagsPop') placeFlagsPop(); });
$('pagesBtn').onclick = e => { e.stopPropagation(); openPop?.pop.id === 'pagesPop' ? closePop() : showPop($('pagesPop'), $('pagesBtn')); };
$('aboutBtn').onclick = e => { e.stopPropagation(); showPop($('help'), $('helpBtn')); };
document.addEventListener('pointerdown', e => { if (openPop && !openPop.pop.contains(e.target) && !openPop.btn.contains(e.target)) closePop(); });
function sheet(on) { $('insp').classList.toggle('open', on); $('scrim').classList.toggle('on', on); $('infoBtn').setAttribute('aria-expanded', on); if (on) Snd.play('tick'); }
$('infoBtn').onclick = () => sheet(!$('insp').classList.contains('open')); $('inspClose').onclick = () => sheet(false); $('scrim').onclick = () => sheet(false);

/* ---------- keyboard ---------- */
addEventListener('keydown', e => {
  if (e.key === 'Escape') { const p = openPop; closePop(); sheet(false); hideTip(); p?.btn.focus?.(); return; } // also from a checkbox in a popover
  if (e.target.closest?.('input,textarea')) return;
  if (scene === 'map' && document.activeElement === $('mapWrap')) {
    const k = e.key;
    if (k === 'ArrowLeft') { e.preventDefault(); return skymap.panBy(0.1, 0); } if (k === 'ArrowRight') { e.preventDefault(); return skymap.panBy(-0.1, 0); }
    if (k === 'ArrowUp') { e.preventDefault(); return skymap.panBy(0, 0.1); } if (k === 'ArrowDown') { e.preventDefault(); return skymap.panBy(0, -0.1); }
    if (k === '+' || k === '=') return mapZoom(1.6); if (k === '-' || k === '_') return mapZoom(1 / 1.6); if (k === 'Enter') return playPatch();
  }
  if ((e.key === 'm' || e.key === 'M') && scene === 'viewer') return toMap();
  if (scene === 'map' && e.key !== '?') return;
  if (e.key === ' ' && !e.target.closest?.('button,[role=slider]')) { e.preventDefault(); $('play').click(); }
  else if (e.key === 'ArrowRight' && !e.target.closest?.('[role=slider]')) step(1);
  else if (e.key === 'ArrowLeft' && !e.target.closest?.('[role=slider]')) step(-1);
  else if (e.key === 'c' || e.key === 'C') setMode('compare', true);
  else if (e.key === 'b' || e.key === 'B') setMode('blink', true);
  else if (e.key === 't' || e.key === 'T') setMode('play', true);
  else if (e.key === '?') showPop($('help'), $('helpBtn'));
});

/* ---------- glare + refraction (from the prototype) ---------- */
if (mq('(hover: hover) and (pointer: fine)')) document.querySelectorAll('.glass').forEach(el => {
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
  const loop = () => { cx += (tx - cx) * .18; cy += (ty - cy) * .18; el.style.setProperty('--gx', cx + 'px'); el.style.setProperty('--gy', cy + 'px');
    raf = (Math.abs(tx - cx) + Math.abs(ty - cy) > .5) ? requestAnimationFrame(loop) : 0; };
  el.addEventListener('pointerenter', e => { const r = el.getBoundingClientRect(); cx = tx = e.clientX - r.left; cy = ty = e.clientY - r.top; el.classList.add('glare-on'); });
  el.addEventListener('pointermove', e => { if (set.motion) return; const r = el.getBoundingClientRect(); tx = e.clientX - r.left; ty = e.clientY - r.top; if (!raf) raf = requestAnimationFrame(loop); });
  el.addEventListener('pointerleave', () => el.classList.remove('glare-on'));
});
const chromium = !!(navigator.userAgentData?.brands?.some(b => /Chromium/.test(b.brand)));
function edgeMap(w, h, rim) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, dl = x, dr = w - 1 - x, dt = y, db = h - 1 - y;
    const fx = dl < rim ? (1 - dl / rim) ** 2 : dr < rim ? -((1 - dr / rim) ** 2) : 0;
    const fy = dt < rim ? (1 - dt / rim) ** 2 : db < rim ? -((1 - db / rim) ** 2) : 0;
    d[i] = 128 + fx * 127; d[i + 1] = 128 + fy * 127; d[i + 2] = 128; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return c.toDataURL();
}
function refraction() {
  const on = chromium && !set.glass && !set.contrast, defs = $('fx');
  document.querySelectorAll('.hero').forEach((el, k) => {
    if (!on || getComputedStyle(el).position === 'fixed') { el.style.backdropFilter = ''; el.style.webkitBackdropFilter = ''; return; }
    const w = Math.max(1, Math.round(el.offsetWidth)), h = Math.max(1, Math.round(el.offsetHeight)), id = 'lg' + k;
    if (el._mapSize === w + 'x' + h) return; el._mapSize = w + 'x' + h;
    let f = document.getElementById(id); if (!f) { defs.insertAdjacentHTML('beforeend', `<filter id="${id}" x="0" y="0" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feImage result="map" preserveAspectRatio="none"/><feDisplacementMap in="SourceGraphic" in2="map" scale="22" xChannelSelector="R" yChannelSelector="G"/></filter>`); f = document.getElementById(id); }
    f.setAttribute('width', w); f.setAttribute('height', h);
    const im = f.querySelector('feImage'); im.setAttribute('href', edgeMap(w, h, Math.min(22, h / 3))); im.setAttribute('width', w); im.setAttribute('height', h);
    el.style.backdropFilter = `url(#${id}) blur(12px) saturate(1.35)`;
  });
}

/* ---------- cursor motion (DESIGN 19): sky reticle with lerp, magnetic snap to pins, click ripple ---------- */
const fine = mq('(hover: hover) and (pointer: fine)');
(() => {
  const cur = $('cur'), tag = $('curTag'), w = $('mapWrap');
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, dragging = false;
  const loop = () => { const k = set.motion ? 1 : .32; cx += (tx - cx) * k; cy += (ty - cy) * k; cur.style.transform = `translate(${cx}px,${cy}px)`;
    raf = Math.abs(tx - cx) + Math.abs(ty - cy) > .3 ? requestAnimationFrame(loop) : 0; };
  if (fine) {
    w.addEventListener('pointermove', e => {
      const r = w.getBoundingClientRect(); let x = e.clientX - r.left, y = e.clientY - r.top, snap = null;
      pinEls.forEach((p, i) => { if (p.hidden) return; const px = parseFloat(p.style.left), py = parseFloat(p.style.top); if (Math.hypot(px - x, py - y) < 18) snap = [px, py, TARGETS[i]]; });
      if (e.buttons) { dragging = true; cur.classList.remove('on'); return; }
      if (snap) { x = snap[0]; y = snap[1]; }
      cur.classList.toggle('snap', !!snap); cur.classList.add('on');
      const p = skymap.aladin ? skymap.toWorld(x, y) : null;
      tag.textContent = snap ? snap[2].name : p ? `${R.fmtRA(p[0])}  ${R.fmtDec(p[1])}` : '';
      if (!cur.dataset.init) { cx = tx = x; cy = ty = y; cur.dataset.init = '1'; }
      tx = x; ty = y; if (!raf) raf = requestAnimationFrame(loop);
    });
    w.addEventListener('pointerleave', () => cur.classList.remove('on'));
    w.addEventListener('pointerdown', () => { dragging = false; cur.classList.add('press'); });
    w.addEventListener('pointerup', () => { cur.classList.remove('press'); if (dragging || set.motion) return;
      const rp = document.createElement('span'); rp.className = 'ripple'; rp.style.left = tx + 'px'; rp.style.top = ty + 'px'; $('mapLayer').appendChild(rp); setTimeout(() => rp.remove(), 460); });
  }
  // magnetic pull: controls lean up to 3 px towards the pointer, then spring back
  if (fine) document.querySelectorAll('.key, .knob, .glass-btn').forEach(el => {
    el.addEventListener('pointermove', e => {
      if (set.motion) return;
      const r = el.getBoundingClientRect(), dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      el.style.setProperty('--mx', (dx * 3).toFixed(2) + 'px'); el.style.setProperty('--my', (dy * 2).toFixed(2) + 'px');
    });
    el.addEventListener('pointerleave', () => { el.style.removeProperty('--mx'); el.style.removeProperty('--my'); });
  });
})();

/* ======================= SKY MAP (map scene) ======================= */
let scene = 'map';
const app = $('app');
const TARGETS = PRESETS.map(p => { const now = propagate(p.target, NOW_MJD); return { key: p.key, name: p.label, id: p.note, ra: now.ra, dec: now.dec, preset: p }; });
const M = { sel: null };
const fovTxt = () => { if (!skymap.aladin) return '–'; const [a, b] = skymap.aladin.getFov(); const f = v => v >= 1 ? v.toFixed(1) + '°' : v * 60 >= 1 ? (v * 60).toFixed(1) + '′' : (v * 3600).toFixed(0) + '″'; return `${f(a)} × ${f(b)}`; };
const skymap = new SkyMap($('mapWrap'), {
  onClick: (ra, dec) => select(ra, dec, null, true),
  onHover: (data) => (data ? showTipAtPointer(`<b>${esc(data.name)}</b><small>${esc(data.type)} · ${esc(data.source || 'catalogue')}</small>`) : hideTip()),
  onView: () => placeOverlays(),
});
// The Ghost (DESIGN.md 24): predicted past/future position on the time-lapse and the sky map.
const TS = createTelescopes({ $, V, P, esc, base: BASE, zoom: () => zoom, get GH() { return GH; } });
const GH = createGhost({ $, V, P, esc, set, Snd, NOW_MJD, skymap, scene: () => scene, mode: () => mode, redraw: () => { if (scene === 'viewer') draw(); } });
let pinEls = [];
function placeOverlays() {
  if (!skymap.aladin) return;
  pinEls.forEach((p, i) => { const t = TARGETS[i], xy = skymap.toPix(t.ra, t.dec); p.hidden = !xy; if (xy) { p.style.left = xy[0] + 'px'; p.style.top = xy[1] + 'px'; } });
  if (M.sel) {
    const xy = skymap.toPix(M.sel.ra, M.sel.dec), pxPerDeg = $('mapWrap').clientWidth / skymap.fov(), sz = Math.max(26, (150 / 3600) * pxPerDeg);
    if (xy) Object.assign($('sel').style, { left: (xy[0] - sz / 2) + 'px', top: (xy[1] - sz / 2) + 'px', width: sz + 'px', height: sz + 'px' });
    $('sel').hidden = !xy;
  }
  GH.placeMap();
  $('mdFov').textContent = fovTxt();
  const c = skymap.center(); readout(c.ra, c.dec);
}
function readout(ra, dec) { const t = `${R.fmtRA(ra)}  ${R.fmtDec(dec)}`; $('mdCursor').textContent = t; $('mapRead').innerHTML = `<span>FOV ${fovTxt()}</span><span class="sep">·</span><span>${t}</span>`; }
$('mapWrap').addEventListener('pointermove', e => { pointer = { x: e.clientX, y: e.clientY }; if (!skymap.aladin) return; const r = $('mapWrap').getBoundingClientRect(), w = skymap.toWorld(e.clientX - r.left, e.clientY - r.top); if (w) readout(w[0], w[1]); });
function mapZoom(f) { if (!skymap.aladin) return; skymap.setFov(skymap.fov() / f); Snd.play(f > 1 ? 'zoomIn' : 'zoomOut'); }
function mapFit() { if (!skymap.aladin) return; skymap.setFov(60); Snd.play('click'); }
function flyTo(ra, dec, fovDeg, done) {
  return skymap.init(ra, dec, fovDeg).then(() => {
    try { skymap.goTo(ra, dec, fovDeg); } catch (err) { console.warn('sky map', err); }
    return new Promise(res => setTimeout(() => { placeOverlays(); done?.(); res(); }, 0));
  }).catch(err => { console.warn('sky map', err); mapFailed(); done?.(); });
}
function mapFailed() { $('stMap').hidden = false; Snd.play('error'); }
$('mapOpenFilm').onclick = () => { $('stMap').hidden = true; if (!M.sel) { const t = TARGETS[0]; M.sel = { ra: t.ra, dec: t.dec, t }; } playPatch(); };
$('mapRetry').onclick = () => location.reload();

function select(ra, dec, t, fromUser) {
  if (!t && fromUser) { // snap a user's click to a nearby target pin (not programmatic selections)
    const hit = TARGETS.find(x => { const a = skymap.toPix(x.ra, x.dec), b = skymap.toPix(ra, dec); return a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) < 16; });
    if (hit) t = hit;
  }
  if (t) { ra = t.ra; dec = t.dec; }
  M.sel = { ra, dec, t }; GH.forSelection(M.sel); placeOverlays(); renderCD(); setCoordText(ra, dec);
  $('mdSel').textContent = t ? t.name : `${ra.toFixed(3)}°, ${dec >= 0 ? '+' : ''}${dec.toFixed(3)}°`;
  updateURL();
  if (fromUser) { Snd.play('tick'); if (innerWidth < 1100) { sheet(true); if (innerWidth < 700) skymap.panBy(0, -0.24); } }
}

/* search / quick picks: fly the map there and select */
async function goTo(text) {
  let q;
  try { q = parseQuery(text); } catch (err) { if (err instanceof QueryError) { showSearchError(text, err.message); Snd.play('error'); return; } throw err; }
  if (scene !== 'map') toMap(true);
  if (q.type === 'coords') { return flyTo(q.ra, q.dec, Math.min(skymap.aladin ? skymap.fov() : 1, 1), () => select(q.ra, q.dec, null, false)); return; }
  const preset = findPreset(q.name);
  if (preset) { const t = TARGETS.find(x => x.key === preset.key); return flyTo(t.ra, t.dec, 2, () => select(t.ra, t.dec, t, false)); return; }
  $('serr').hidden = true; toast(`Looking up “${q.name}” in SIMBAD…`);
  try {
    const tg = await resolveTarget(q);
    const now = (tg.pmra || tg.pmdec) ? propagate(tg, NOW_MJD) : tg;
    const t = { key: 'q', name: tg.name, id: tg.otype ? otypeName(tg.otype) : 'SIMBAD object', ra: now.ra, dec: now.dec, simbad: tg };
    await flyTo(t.ra, t.dec, 2, () => select(t.ra, t.dec, t, false));
  } catch (err) { showSearchError(q.name, /recursive|wasm|unreachable|aliasing/i.test(err.message) ? '' : err.message); Snd.play('error'); }
}
function showSearchError(text, why) {
  const near = TARGETS.find(x => { const a = x.name.toLowerCase().replace(/[^a-z]/g, ''), b = String(text).toLowerCase().replace(/[^a-z]/g, ''); return b.length > 3 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))); });
  const el = $('serr'); el.hidden = false;
  el.innerHTML = `<span>${why ? esc(why) : `Couldn't find “${esc(text)}”.`}</span>${near ? `<button class="key" id="serrFix">Try ${esc(near.name)}</button>` : ''}<span style="color:var(--muted)">or type RA Dec like 269.45 +4.69</span>`;
  if (near) $('serrFix').onclick = () => { el.hidden = true; $('q').value = near.name; goTo(near.name); };
}
$('q').addEventListener('input', () => { $('serr').hidden = true; });
function doSearch() { $('serr').hidden = true; Snd.play('click'); goTo($('q').value); }
document.querySelector('form.search').onsubmit = (e) => { e.preventDefault(); doSearch(); };
document.querySelectorAll('.pick').forEach(b => { b.onclick = () => { Snd.play('click'); document.querySelectorAll('.pick').forEach(x => x.setAttribute('aria-pressed', x === b)); $('q').value = b.textContent; goTo(b.textContent); }; });

/* ---------- coordinate details panel ---------- */
const CP = '<svg class="cp" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.5A1 1 0 0 1 4 2.5h6.5"/></svg><svg class="ok" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
const TAGS = { obs: ['t-obs', 'Observed'], calc: ['t-calc', 'Computed'], cat: ['t-cat', 'Catalogue'] };
const row = (label, value, tag) => `<div class="cd-row"><span class="cd-l">${label}</span><span class="cd-t"><span class="t-mini ${TAGS[tag][0]}">${TAGS[tag][1]}</span></span><span class="cd-v">${value}</span><button class="key cd-c" aria-label="Copy ${label}">${CP}</button></div>`;
const sgn = v => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(4) + '°';
let cdCtl = null, repaintMot = null;
function catalogueOf(t) { return t?.preset?.target || t?.simbad || null; }

/* ---------- Motion panel (DESIGN.md 27): one row per quantity, unit, source tag ---------- */
const nf = (v, d) => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fx = (v, d) => (v < 0 ? '−' : '') + nf(v, d);
const fsg = (v, d) => (v < 0 ? '−' : '+') + nf(v, d);
const pm = (e, d = 2) => (Number.isFinite(e) && e > 0 ? ` ± ${nf(e, Math.min(4, Math.max(d, -Math.floor(Math.log10(e)))))}` : '');
const fYears = y => y < 10 ? y.toPrecision(2) : Math.round(y).toLocaleString('en-US');
function motionDial(pa) { // 64 px, north up, east left, fixed-length arrow
  const r = pa * Math.PI / 180, dx = -Math.sin(r), dy = -Math.cos(r), L = 17, x = 32 + dx * L, y = 32 + dy * L;
  const hx = -dy, hy = dx, b = 6, bx = x - dx * b, by = y - dy * b;
  return `<div class="mot-dial well" role="img" aria-label="Moves towards position angle ${pa.toFixed(1)} degrees, east of north">
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" class="md-ring"/>
    <text x="32" y="10" class="md-lab">N</text><text x="7" y="35" class="md-lab">E</text>
    <line x1="32" y1="32" x2="${(x - dx * 2).toFixed(2)}" y2="${(y - dy * 2).toFixed(2)}" class="md-arrow"/>
    <path d="M${x.toFixed(2)} ${y.toFixed(2)}L${(bx + hx * 4).toFixed(2)} ${(by + hy * 4).toFixed(2)}L${(bx - hx * 4).toFixed(2)} ${(by - hy * 4).toFixed(2)}Z" class="md-head"/>
    <circle cx="32" cy="32" r="2" class="md-dot"/></svg>
    <span class="md-txt"><span class="num">${pa.toFixed(1)}°</span><span class="quiet">Direction of motion, east of north (north up, east left). The arrow length is fixed; the numbers give the size.</span></span></div>`;
}
// sel: { ra, dec }; cat: built-in or SIMBAD record; gaia: Gaia DR3 match (or null); same: this patch was played.
function motionHTML(sel, t, cat, gaia, same, looking) {
  const preset = !!t?.preset;
  const pmFrom = gaia || (cat && (cat.pmra || cat.pmdec) ? cat : null);
  const plxFrom = gaia && gaia.plx > 0 ? gaia : (cat?.plx > 0 ? cat : null);
  const rvFrom = gaia && Number.isFinite(gaia.rv) ? gaia : (cat && Number.isFinite(cat.rv) ? cat : null);
  const srcName = r => r === gaia ? 'Gaia DR3' : preset ? 'SIMBAD (built-in)' : 'SIMBAD';
  const k = pmFrom ? kinematics({ ra: sel.ra, dec: sel.dec, pmra: pmFrom.pmra, pmdec: pmFrom.pmdec, pmraErr: pmFrom.pmraErr, pmdecErr: pmFrom.pmdecErr,
    plx: plxFrom?.plx, plxErr: plxFrom?.plxErr, rv: rvFrom?.rv }) : null;
  let more = '', h = '';
  if (!k || k.mu == null) {
    h += looking ? '<p class="quiet">Looking up the motion in Gaia DR3…</p>' : '<p class="quiet">No catalogued motion for this object.</p>';
  } else {
    h += motionDial(k.pa) +
      row('Proper motion, total and direction', `${nf(k.mu, 1)}${pm(k.muErr)} mas/yr · ${k.pa.toFixed(1)}°`, 'cat') +
      row('Proper motion, east · north', `${fsg(pmFrom.pmra, 1)}${pm(pmFrom.pmraErr)} · ${fsg(pmFrom.pmdec, 1)}${pm(pmFrom.pmdecErr)} mas/yr`, 'cat') +
      row('Angular speed across the sky', `${k.arcsecYr.toFixed(k.arcsecYr < 0.1 ? 4 : 2)}″/yr · 1 pixel every ${fYears(k.yrPerPix)} years`, 'calc');
    if (k.dist) {
      h += row('Parallax', `${nf(plxFrom.plx, 3)}${pm(plxFrom.plxErr, 3)} mas`, 'cat') +
        row('Distance (1000 / parallax)', `${k.dist.pc < 100 ? k.dist.pc.toFixed(3) : nf(k.dist.pc, 0)} pc · ${k.dist.ly < 100 ? k.dist.ly.toFixed(2) : nf(k.dist.ly, 0)} ly`, 'calc');
      if (k.dist.weak) h += `<p class="quiet err">Parallax is only ${k.dist.snr.toFixed(1)}× its error (under 5×), so this distance and the speeds below are unreliable.</p>`;
    }
    if (k.vt != null) h += row('Speed across the sky', `${k.vt.toFixed(1)}${pm(k.vtErr, 1)} km/s`, 'calc');
    if (k.vr != null) h += row('Radial velocity', `${fsg(k.vr, 1)}${pm(rvFrom === gaia ? gaia.rvErr : null, 1)} km/s · ${k.vr < 0 ? 'towards us' : 'away from us'}`, 'cat');
    if (k.vtot != null) h += row('Speed through space', `${k.vtot.toFixed(1)} km/s`, 'calc');
    if (k.uvw) { // Design §27 follow-up: these two rows live in the closed "More detail" disclosure
      const L = toLSR(k.uvw);
      more += row('Galactic U, V, W (relative to the Sun)', `${fx(k.uvw.U, 1)}, ${fx(k.uvw.V, 1)}, ${fx(k.uvw.W, 1)} km/s`, 'calc') +
        row('Galactic U, V, W (local standard of rest)', `${fx(L.U, 1)}, ${fx(L.V, 1)}, ${fx(L.W, 1)} km/s`, 'calc');
    }
  }
  // measured in these images (OBSERVED), once the patch has been played and the fit is final
  if (same && V.motion?.ok && firstS() && lastS() && V.stacks.length > 1) {
    // data.js significance rule (also on the Proof page): under 3σ -> "no significant motion (< upper limit)"
    const m = V.motion.total / 1000, me = V.motion.totalErr / 1000, sig = V.motion.significant !== false;
    const val = sig ? `${m.toFixed(2)} ± ${me.toFixed(2)}″/yr` : `no significant motion (&lt; ${(V.motion.upperLimit / 1000).toFixed(2)}″/yr)`;
    const nHid = V.FA.length - V.F.length, used = nHid > 0 ? `flagged images hidden, ${V.motion.frames} images` : `from ${V.motion.frames} images`;
    h += row('Measured in these images (SPHEREx)', `${val} · ${used}`, 'obs');
    if (k?.mu != null) h += `<p class="mot-cmp num">Catalogue ${k.arcsecYr.toFixed(2)}″/yr · measured here ${sig ? `${m.toFixed(1)} ± ${me.toFixed(1)}″/yr` : val}</p>`;
    const vtm = sig ? tangentialVelocity(V.motion.total, plxFrom?.plx) : null;
    if (vtm) h += row('Speed across the sky, from the measured motion', `${vtm.toFixed(0)} km/s`, 'calc');
  } else if (!same && k?.mu != null) h += '<p class="quiet">Play this patch to measure the motion from the SPHEREx images.</p>';
  if (k?.mu != null) {
    const parts = [`motion: ${srcName(pmFrom)}${gaia ? ` ${esc(gaia.source.replace('Gaia DR3 ', ''))}` : ''}`];
    if (plxFrom) parts.push(`parallax: ${srcName(plxFrom)}`);
    if (rvFrom) parts.push(`radial velocity: ${srcName(rvFrom)}`);
    h += `<p class="quiet mot-src">Catalogue values · ${parts.join(' · ')}${gaia && !cat ? ' (brightest Gaia star within 8″ of this point, epoch 2016)' : ''}.</p>` +
      `<details class="mot-how"><summary>More detail</summary>${more}<p class="mot-how-h">How these are worked out</p><ul>
        <li>Total proper motion μ = √(μα*² + μδ²); direction = position angle east of north.</li>
        <li>Pixel time: one SPHEREx pixel is 6.2″.</li>
        <li>Distance = 1000 / parallax (pc); not trusted when parallax &lt; 5× its error.</li>
        <li>Speed across the sky = 4.74047 × μ / parallax (km/s).</li>
        <li>Speed through space = √(across² + radial²).</li>
        <li>U, V, W: Johnson &amp; Soderblom (1987), U towards the Galactic centre, V along rotation, W to the north Galactic pole. The first row is relative to the Sun with no solar-motion correction; the second adds the Sun's motion (11.1, 12.24, 7.25 km/s, Schönrich et al. 2010).</li>
      </ul></details>`;
  }
  return h;
}
function renderCD() {
  const s = M.sel; if (!s) return; const t = s.t, cat = catalogueOf(t);
  cdCtl?.abort(); const ctl = cdCtl = new AbortController();
  $('cdName').textContent = t ? t.name : 'Unnamed patch';
  $('cdSub').textContent = t ? t.id : 'Selected by you on the map';
  const g = toGalactic(s.ra, s.dec), e = toEcliptic(s.ra, s.dec), con = constellation(s.ra, s.dec);
  $('cdPos').innerHTML = row('RA', `${R.fmtRA(s.ra)} · ${s.ra.toFixed(5)}°`, t ? 'cat' : 'calc') + row('Dec', `${R.fmtDec(s.dec)} · ${sgn(s.dec)}`, t ? 'cat' : 'calc') +
    row('Galactic l, b', `${g.l.toFixed(4)}°, ${sgn(g.b)}`, 'calc') + row('Ecliptic λ, β', `${e.lon.toFixed(4)}°, ${sgn(e.lat)}`, 'calc') +
    (con ? row('Constellation', esc(con.name), 'calc') : '') +
    (t && cat && (cat.pmra || cat.pmdec) ? '<p class="quiet">Position shown for Nov 2026 (catalogue position moved along its proper motion).</p>' : '');
  // coverage: asked live from IRSA
  $('cdCov').innerHTML = '<p class="quiet">Asking IRSA what SPHEREx has here…</p>';
  const to = AbortSignal.timeout(20000);
  listImages(s.ra, s.dec, { base: BASE, signal: AbortSignal.any([ctl.signal, to]) }).then(imgs => {
    if (ctl.signal.aborted) return;
    if (!imgs.length) { $('cdCov').innerHTML = '<p class="quiet">No SPHEREx images cover this point in the released data yet.</p>'; return; }
    const d = (m) => mjdToDate(m).toISOString().slice(0, 10), dets = [...new Set(imgs.map(i => i.detector))].sort();
    $('cdCov').innerHTML = row('SPHEREx images', `${imgs.length.toLocaleString()} images`, 'obs') + row('Date span', `${d(imgs[0].mjdStart)} → ${d(imgs[imgs.length - 1].mjdStart)}`, 'obs') +
      row('Detectors', dets.map(x => 'D' + x).join(', ') + ` · ${Math.min(...imgs.map(i => i.bandMinUm || 9)).toFixed(2)}–${Math.max(...imgs.map(i => i.bandMaxUm || 0)).toFixed(2)} µm`, 'obs');
  }).catch(() => { if (!ctl.signal.aborted) $('cdCov').innerHTML = '<p class="quiet err">IRSA did not answer in 20 s. Click the spot again to retry.</p>'; });
  // motion (DESIGN.md 27): catalogue now (SIMBAD / built-in), Gaia DR3 when the Ghost's match arrives
  const pending = !t?.preset && GH.G.mStar, ms = { gaia: null, looking: !!pending };
  const paintMot = repaintMot = () => { // also called by remeasure() when the measured motion changes
    if (ctl.signal.aborted) return;
    const same = !!(V.motion && V.target && Math.abs(V.target.ra - (cat?.ra ?? s.ra)) < 1e-6 && Math.abs(V.target.dec - (cat?.dec ?? s.dec)) < 1e-6);
    $('cdMot').innerHTML = motionHTML(s, t, cat, ms.gaia, same, ms.looking);
  };
  paintMot();
  if (pending) pending.then(st => { ms.gaia = st?.gaia ? st : null; ms.looking = false; paintMot(); }, () => { ms.looking = false; paintMot(); });
  // nearby catalogued objects (SIMBAD), 3 rows, clickable
  $('cdNear').innerHTML = '<p class="quiet">Asking SIMBAD…</p>';
  simbadCone(s.ra, s.dec, 3 / 60, { limit: 400, signal: ctl.signal, timeoutMs: 12000 }).then(rows => {
    if (ctl.signal.aborted) return;
    const list = rows.map(o => ({ ...o, sep: separationArcsec(s.ra, s.dec, o.ra, o.dec) })).sort((a, b) => a.sep - b.sep).slice(0, 3);
    $('cdNear').innerHTML = list.length ? list.map((o, k) => `<button class="near" data-k="${k}"><span>${esc(o.name)}</span><span>${o.sep < 60 ? o.sep.toFixed(0) + '″' : (o.sep / 60).toFixed(1) + '′'} away</span></button>`).join('') +
      '<p class="quiet">From SIMBAD (catalogue positions, epoch 2000). Distance: computed.</p>' : '<p class="quiet">No catalogued objects within 3′ (SIMBAD).</p>';
    $('cdNear').querySelectorAll('.near').forEach(bt => { bt.onclick = () => { const o = list[+bt.dataset.k]; Snd.play('click'); flyTo(o.ra, o.dec, skymap.fov(), () => select(o.ra, o.dec, { key: 'n', name: o.name, id: otypeName(o.otype) + ' · SIMBAD', ra: o.ra, dec: o.dec }, false)); }; });
  }).catch(() => { if (!ctl.signal.aborted) $('cdNear').innerHTML = '<p class="quiet err">SIMBAD (the star catalogue) did not answer in 12 s. Click the spot again to retry.</p>'; });
  renderObs();
  $('cdPlay').disabled = false; $('mdPlay').disabled = false;
}
$('cdPanel').addEventListener('click', e => { const b = e.target.closest('.cd-c'); if (!b) return; const v = b.parentElement.querySelector('.cd-v').textContent;
  try { navigator.clipboard?.writeText(v); } catch { /* ignore */ } b.classList.add('done'); Snd.play('confirm'); setTimeout(() => b.classList.remove('done'), 1500); });

/* ---------- observer location (opt-in, kept in memory only) ---------- */
// alt/az and rise/transit/set come from sky.js (precessed to date, −0.5667° horizon, current pass when up)
const hm = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayTag = d => { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(d); b.setHours(0, 0, 0, 0); const k = Math.round((b - a) / 864e5); return k === 0 ? 'today' : k === 1 ? 'tomorrow' : k === -1 ? 'yesterday' : b.toLocaleDateString(); };
const PLACES = { london: [51.507, -0.128], paris: [48.857, 2.352], 'new york': [40.713, -74.006], 'los angeles': [34.052, -118.244], tokyo: [35.676, 139.650],
  sydney: [-33.869, 151.209], colombo: [6.927, 79.861], kandy: [7.291, 80.636], galle: [6.053, 80.221], jaffna: [9.661, 80.026], wennappuwa: [7.349, 79.851],
  negombo: [7.209, 79.838], mumbai: [19.076, 72.878], delhi: [28.614, 77.209], chennai: [13.083, 80.270], singapore: [1.352, 103.820], dubai: [25.205, 55.271],
  'cape town': [-33.925, 18.424], 'são paulo': [-23.551, -46.633], 'sao paulo': [-23.551, -46.633], berlin: [52.520, 13.405], madrid: [40.417, -3.704], toronto: [43.653, -79.383] };
const obs = { on: false, loc: null, msg: '', err: false }; let obsTimer = null;
function obsOn(on) { obs.on = on; if (!on) { obs.loc = null; obs.msg = ''; } $('obsSw').setAttribute('aria-checked', on); $('obsBody').hidden = !on; renderObs(); Snd.play('click'); }
$('obsSw').onclick = () => obsOn(!obs.on);
function setLoc(lat, lon, label) { obs.loc = { lat, lon, label }; obs.msg = ''; obs.err = false; renderObs(); Snd.play('confirm'); }
function setPlace(text) {
  const q = String(text).trim().toLowerCase(), m = q.match(/^([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([+-]?\d+(?:\.\d+)?)$/);
  if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) return setLoc(+m[1], +m[2], 'Typed position');
  if (PLACES[q]) return setLoc(PLACES[q][0], PLACES[q][1], q.replace(/\b\w/g, c => c.toUpperCase()));
  obs.msg = `We don't know “${esc(text)}”. Type a big city (e.g. Colombo, London) or latitude, longitude like 6.93, 79.86.`; obs.err = true; renderObs(); Snd.play('error');
}
function useDevice() {
  if (!navigator.geolocation) { obs.msg = "This browser can't share its location. Type a place instead."; obs.err = true; return renderObs(); }
  obs.msg = 'Asking your browser for your location…'; obs.err = false; renderObs();
  navigator.geolocation.getCurrentPosition(p => setLoc(+p.coords.latitude.toFixed(3), +p.coords.longitude.toFixed(3), 'Your device location'),
    () => { obs.msg = 'Location permission was blocked or unavailable. Type a place instead.'; obs.err = true; renderObs(); Snd.play('error'); setTimeout(() => $('placeIn')?.focus(), 30); },
    { timeout: 8000, maximumAge: 600000 });
}
function renderObs() {
  const body = $('obsBody'); clearInterval(obsTimer); if (!obs.on) { body.innerHTML = ''; return; }
  const s = M.sel; if (!s) return;
  if (!obs.loc) {
    body.innerHTML = `<button class="key" id="devLoc">Use device location</button>
      <form class="place" id="placeForm"><label class="field well"><input id="placeIn" placeholder="Type a place: city or lat, long" aria-label="Type a place: city or latitude, longitude" autocomplete="off"></label><button class="key">Set</button></form>
      <p class="obs-msg">Places come from a short built-in list, so nothing is looked up online.</p>
      ${obs.msg ? `<p class="obs-msg ${obs.err ? 'err' : ''}" role="${obs.err ? 'alert' : 'status'}">${obs.msg}</p>` : ''}`;
    $('devLoc').onclick = () => { Snd.play('click'); useDevice(); };
    $('placeForm').onsubmit = e => { e.preventDefault(); setPlace($('placeIn').value); };
    return;
  }
  const now = new Date(), { lat, lon, label } = obs.loc, { alt, az } = altAz(s.ra, s.dec, lat, lon, now), rs = riseTransitSet(s.ra, s.dec, lat, lon, now);
  const vis = visibleTonight(s.ra, s.dec, lat, lon, new Date());
  const up = alt > 0, when = d => `${hm(d)} ${dayTag(d)}`;
  body.innerHTML = `<div class="obs-set"><span>${esc(label)} · <span class="num">${lat.toFixed(2)}°, ${lon.toFixed(2)}°</span></span><button class="key" id="clrLoc" style="min-height:32px">Clear</button></div>
    <span class="updown ${up ? '' : 'down'}"><i></i>${up ? 'Up now' : 'Below the horizon now'}</span>
    <div>${row('Altitude / azimuth now', `${alt.toFixed(1)}° / ${az.toFixed(1)}°`, 'calc')}
    ${rs.always === 'up' ? row('Rise / set', 'Never sets from here', 'calc') : rs.always === 'down' ? row('Rise / set', 'Never rises from here', 'calc')
      : row(rs.up ? 'Rose' : 'Rise', when(rs.rise), 'calc') + row(rs.up && rs.transit < now ? 'Was highest (transit)' : 'Highest (transit)', when(rs.transit), 'calc') + row('Set', when(rs.set), 'calc')}
    ${row('Dark-sky viewing (next 24 h)', vis.hours > 0 ? `${vis.hours.toFixed(1)} h above 20°, best ${when(vis.bestTime)} (${vis.bestAlt.toFixed(0)}°)` : 'Not above 20° while it is dark', 'calc')}</div>
    <p class="obs-msg">Times in your browser's time zone. Worked out from your position and the clock; no internet needed.</p>`;
  $('clrLoc').onclick = () => { obs.loc = null; renderObs(); Snd.play('click'); };
  obsTimer = setInterval(renderObs, 30000);
}

/* ---------- IR band-range editor (domain 0.74–5.01 µm) ---------- */
const DOMN = [0.74, 5.01];
const DETS = [[0.744, 1.116], [1.099, 1.651], [1.636, 2.421], [2.423, 3.822], [3.809, 4.420], [4.412, 5.002]]; // SPHEREx Explanatory Supplement v2.0
const PALETTE = [['Copper', '#C27A43'], ['Sage', '#6F8A72'], ['Slate', '#5E7FA3'], ['Heather', '#9B6FA3'], ['Straw', '#D2B85A'], ['Brick', '#B5533F'], ['Moss', '#7A8B3A'], ['Clay', '#C98F6B'], ['Plum', '#7D4E6E'], ['Stone', '#8C8279']];
// Team defaults live in bands.js (DEFAULT_BANDS): names, ranges, colours and a short explanation each.
const DEFAULT_RANGES = DEFAULT_BANDS.map(b => ({ id: b.id, name: b.name, min: b.min, max: b.max, c: b.color, tip: b.tip }));
const BKEY = 'tgi-bands-v2', MKEY = 'tgi-mapbands-v1'; // v2: team default names (14 Nov)
let ranges = (() => { try { return JSON.parse(localStorage.getItem(BKEY)) || null; } catch { return null; } })() || JSON.parse(JSON.stringify(DEFAULT_RANGES));
let mapBands = (() => { try { return localStorage.getItem(MKEY) === 'on'; } catch { return false; } })();
const saveRanges = () => { try { localStorage.setItem(BKEY, JSON.stringify(ranges)); } catch { /* private mode */ } };
const r2 = v => Math.round(v * 100) / 100;
const pct = um => (um - DOMN[0]) / (DOMN[1] - DOMN[0]) * 100;
function rangeOf(um) { return um == null ? null : ranges.find(r => um >= r.min && um <= r.max) || null; }
function hexRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function onColour(h) { const [r, g, b] = hexRgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return (.2126 * r + .7152 * g + .0722 * b) > .28 ? '#1A1410' : '#FFF8F0'; }
function colourDist(a, b) { const x = hexRgb(a), y = hexRgb(b); const rm = (x[0] + y[0]) / 2; return Math.sqrt((2 + rm / 256) * (x[0] - y[0]) ** 2 + 4 * (x[1] - y[1]) ** 2 + (2 + (255 - rm) / 256) * (x[2] - y[2]) ** 2); }
function warnings(r) {
  const w = [];
  if (!(r.min < r.max)) w.push('Min must be smaller than max.');
  ranges.forEach(o => { if (o !== r && r.min < o.max && o.min < r.max) w.push(`Overlaps ${esc(o.name)} (allowed).`); });
  ranges.forEach(o => { if (o !== r && colourDist(r.c, o.c) < 70) w.push(`Colour looks close to ${esc(o.name)}; the names still tell them apart.`); });
  return w;
}
function applyMapBands() {
  $('mapBandsSw').setAttribute('aria-checked', mapBands);
  skymap.setBands(mapBands ? layersFor(ranges.map(r => ({ on: true, min: r.min, max: r.max, color: r.c }))) : []);
}
function applyRanges() {
  ticks.forEach((t, k) => { const r = rangeOf(V.F[k]?.um); t.classList.toggle('ranged', !!r); if (r) t.style.setProperty('--rc', r.c); else t.style.removeProperty('--rc'); });
  if (scene === 'viewer') draw();
}
let openPal = null;
function renderBands(focusId) {
  $('detRow').innerHTML = DETS.map(([a, b], i) => `<span class="det" style="left:${pct(a)}%;width:${pct(b) - pct(a)}%;${i % 2 ? 'top:0' : ''}" title="Detector ${i + 1}: ${a}–${b} µm">D${i + 1}</span>`).join('');
  let sc = ''; for (let v = 1; v <= 5; v += .25) { const maj = Math.abs(v - Math.round(v)) < 1e-9; sc += `<i class="${maj ? 'maj' : ''}" style="left:${pct(v)}%"></i>` + (maj ? `<span style="left:${pct(v)}%;${v === 5 ? 'transform:translateX(-100%)' : ''}">${v} µm</span>` : ''); }
  $('scaleRow').innerHTML = sc;
  $('lanes').innerHTML = ranges.map(r => `<div class="lane"><div class="band" data-id="${r.id}" style="--c:${r.c};--on:${onColour(r.c)};left:${pct(r.min)}%;width:${Math.max(0, pct(r.max) - pct(r.min))}%" title="${esc(r.name + (r.tip ? ': ' + r.tip : ''))}">
      <span class="h l" role="slider" tabindex="0" id="h-${r.id}-min" aria-label="${esc(r.name)} start" aria-valuemin="${DOMN[0]}" aria-valuemax="${DOMN[1]}" aria-valuenow="${r.min}" aria-valuetext="${r.min.toFixed(2)} micrometres"></span>
      <span class="bn">${esc(r.name)}</span>
      <span class="h r" role="slider" tabindex="0" id="h-${r.id}-max" aria-label="${esc(r.name)} end" aria-valuemin="${DOMN[0]}" aria-valuemax="${DOMN[1]}" aria-valuenow="${r.max}" aria-valuetext="${r.max.toFixed(2)} micrometres"></span></div></div>`).join('');
  $('rows').innerHTML = ranges.map(r => `<div class="rrow" data-id="${r.id}">
      <button class="swatch" style="--c:${r.c}" aria-label="Colour of ${esc(r.name)}: ${esc((PALETTE.find(p => p[1].toLowerCase() === r.c.toLowerCase()) || ['custom'])[0])}" aria-expanded="${openPal === r.id}"></button>
      <label class="field well" title="${esc(r.tip || '')}"><input class="rn" value="${esc(r.name)}" aria-label="Name" maxlength="32"></label>
      <label class="field well"><input class="rmin" type="number" step="0.01" min="${DOMN[0]}" max="${DOMN[1]}" value="${r.min.toFixed(2)}" aria-label="${esc(r.name)} from, micrometres"></label>
      <label class="field well"><input class="rmax" type="number" step="0.01" min="${DOMN[0]}" max="${DOMN[1]}" value="${r.max.toFixed(2)}" aria-label="${esc(r.name)} to, micrometres"></label>
      <button class="key icon rdel" aria-label="Delete ${esc(r.name)}"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9"/></svg></button>
      ${r.tip ? `<p>${esc(r.tip)}</p>` : ''}
      <div class="rwarn" role="status">${warnings(r).join(' ')}</div>
      ${openPal === r.id ? `<div class="palette well">${PALETTE.map(([nm, c]) => `<button style="--c:${c}" data-c="${c}" aria-label="${nm}" aria-pressed="${c.toLowerCase() === r.c.toLowerCase()}" title="${nm}"></button>`).join('')}
        <label class="field well"><input class="hex" value="${r.c}" aria-label="Hex colour" maxlength="7"></label></div>` : ''}
    </div>`).join('');
  bindBands();
  if (focusId) document.getElementById(focusId)?.focus();
}
function commit(focusId) { saveRanges(); renderBands(focusId); applyRanges(); if (mapBands) applyMapBands(); }
function bindBands() {
  const lanesBox = $('lanes');
  lanesBox.querySelectorAll('.band').forEach(bandEl => {
    const r = ranges.find(x => x.id === bandEl.dataset.id);
    bandEl.addEventListener('pointerdown', e => {
      const handle = e.target.closest('.h'), kind = handle ? (handle.classList.contains('l') ? 'min' : 'max') : 'move';
      const box = lanesBox.getBoundingClientRect(), x0 = e.clientX, a0 = r.min, b0 = r.max; bandEl.setPointerCapture(e.pointerId); bandEl.classList.add('drag');
      const umPer = (DOMN[1] - DOMN[0]) / box.width;
      bandEl.onpointermove = ev => {
        const d = (ev.clientX - x0) * umPer;
        if (kind === 'move') { const w = b0 - a0; const a = r2(Math.min(Math.max(DOMN[0], a0 + d), DOMN[1] - w)); r.min = a; r.max = r2(a + w); }
        if (kind === 'min') r.min = r2(Math.min(Math.max(DOMN[0], a0 + d), r.max - 0.01));
        if (kind === 'max') r.max = r2(Math.max(Math.min(DOMN[1], b0 + d), r.min + 0.01));
        bandEl.style.left = pct(r.min) + '%'; bandEl.style.width = (pct(r.max) - pct(r.min)) + '%';
        const rowEl = $('rows').querySelector(`[data-id="${r.id}"]`); rowEl.querySelector('.rmin').value = r.min.toFixed(2); rowEl.querySelector('.rmax').value = r.max.toFixed(2);
      };
      bandEl.onpointerup = () => { bandEl.onpointermove = null; bandEl.classList.remove('drag'); Snd.play('tick'); commit(); };
    });
    bandEl.querySelectorAll('.h').forEach(h => h.addEventListener('keydown', e => {
      const k = h.classList.contains('l') ? 'min' : 'max', st = e.shiftKey ? 0.1 : 0.01;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault(); e.stopPropagation();
      const dir = (e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 1 : -1;
      if (k === 'min') r.min = r2(Math.min(Math.max(DOMN[0], r.min + dir * st), r.max - 0.01)); else r.max = r2(Math.max(Math.min(DOMN[1], r.max + dir * st), r.min + 0.01));
      commit(h.id);
    }));
  });
  $('rows').querySelectorAll('.rrow').forEach(rowEl => {
    const r = ranges.find(x => x.id === rowEl.dataset.id), warn = rowEl.querySelector('.rwarn');
    rowEl.querySelector('.rn').addEventListener('input', e => { r.name = e.target.value || 'Untitled'; r.tip = ''; saveRanges(); const b = $('lanes').querySelector(`[data-id="${r.id}"] .bn`); if (b) b.textContent = r.name; applyRanges(); });
    rowEl.querySelector('.rn').addEventListener('change', () => commit());
    const num = (cls, key) => rowEl.querySelector(cls).addEventListener('change', e => {
      let v = parseFloat(String(e.target.value).replace(',', '.'));
      if (isNaN(v)) { warn.textContent = 'Type a number in micrometres, e.g. 1.25.'; return; }
      let note = '';
      if (v < DOMN[0] || v > DOMN[1]) { note = `SPHEREx can't see ${v} µm (its range is ${DOMN[0]}–${DOMN[1]} µm), so it was kept inside that range.`; v = Math.min(DOMN[1], Math.max(DOMN[0], v)); }
      const other = key === 'min' ? r.max : r.min;
      if ((key === 'min' && v >= other) || (key === 'max' && v <= other)) {
        e.target.value = r[key].toFixed(2);
        warn.textContent = `${note ? note + ' ' : ''}The range would run backwards: "from" must be smaller than "to". Put the smaller wavelength first.`; Snd.play('error'); return;
      }
      r[key] = r2(v); commit(); if (note) { const w = $('rows').querySelector(`[data-id="${r.id}"] .rwarn`); if (w) w.textContent = note + ' ' + warnings(r).join(' '); }
    });
    num('.rmin', 'min'); num('.rmax', 'max');
    rowEl.querySelector('.swatch').onclick = () => { openPal = openPal === r.id ? null : r.id; Snd.play('tick'); renderBands(); };
    rowEl.querySelector('.rdel').onclick = () => { ranges = ranges.filter(x => x !== r); Snd.play('click'); commit(); toast(`Deleted ${r.name}.`); };
    rowEl.querySelectorAll('.palette button').forEach(b => { b.onclick = () => { r.c = b.dataset.c; Snd.play('tick'); commit(); }; });
    const hex = rowEl.querySelector('.hex'); if (hex) hex.addEventListener('change', () => { const v = hex.value.trim(); if (hexRgb(v)) { r.c = v.startsWith('#') ? v : '#' + v; commit(); } else { warn.textContent = 'Use a hex colour like #C27A43.'; } });
  });
}
$('addRange').onclick = () => { if (ranges.length >= 8) { toast('Up to 8 ranges. Delete one first.'); return; } const used = ranges.map(r => r.c.toLowerCase()); const c = (PALETTE.find(p => !used.includes(p[1].toLowerCase())) || PALETTE[0])[1];
  ranges.push({ id: 'r' + Date.now().toString(36), name: `Range ${ranges.length + 1}`, min: 2.0, max: 2.5, c }); Snd.play('click'); commit(); };
$('resetRanges').onclick = () => { ranges = JSON.parse(JSON.stringify(DEFAULT_RANGES)); openPal = null; Snd.play('click'); commit(); toast('Default ranges restored.'); };
$('mapBandsSw').onclick = () => { mapBands = !mapBands; try { localStorage.setItem(MKEY, mapBands ? 'on' : 'off'); } catch { /* ignore */ } applyMapBands(); Snd.play('click'); };
function openBands() {
  const pop = $('bands'), btn = $('bandTool'); closePop(); const r = btn.getBoundingClientRect(); pop.hidden = false;
  const w = Math.min(640, innerWidth - 24), left = Math.min(Math.max(12, r.right + 10), innerWidth - w - 12);
  pop.style.left = left + 'px'; pop.style.right = 'auto'; pop.style.transformOrigin = 'top left';
  renderBands(); pop.style.top = Math.max(12, Math.min(r.top - 40, innerHeight - pop.offsetHeight - 12)) + 'px'; requestAnimationFrame(() => pop.classList.add('open')); btn.setAttribute('aria-expanded', 'true'); openPop = { pop, btn }; Snd.play('tick');
  setTimeout(() => pop.querySelector('.h')?.focus(), 40);
}
$('bandTool').onclick = e => { e.stopPropagation(); openPop?.pop.id === 'bands' ? closePop() : openBands(); };

/* ---------- star name tooltips (hover, focus, tap) ---------- */
let tipT = 0, pointer = { x: 0, y: 0 };
function placeTip(rect) {
  const tip = $('tip'); tip.classList.add('show');
  const tw = tip.offsetWidth, th = tip.offsetHeight; let x = rect.right + 8, y = rect.top + rect.height / 2 - th / 2;
  if (x + tw > innerWidth - 8) x = rect.left - tw - 8; y = Math.max(8, Math.min(y, innerHeight - th - 8));
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function showTip(el, html, delay) { clearTimeout(tipT); tipT = setTimeout(() => { $('tip').innerHTML = html; placeTip(el.getBoundingClientRect()); }, delay); }
function showTipAtPointer(html) { clearTimeout(tipT); tipT = setTimeout(() => { $('tip').innerHTML = html; placeTip({ left: pointer.x - 10, right: pointer.x + 10, top: pointer.y - 10, height: 20 }); }, 120); }
function hideTip() { clearTimeout(tipT); $('tip').classList.remove('show'); }
function bindTip(el, html) {
  el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') showTip(el, html(), 120); });
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', () => showTip(el, html(), 0)); el.addEventListener('blur', hideTip);
  el.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') { showTip(el, html(), 0); setTimeout(hideTip, 2500); } });
}
let otherPx = null, otherName = null;
function findOther() { // brightest other source in the first-season stack, then ask SIMBAD what it is
  const f = firstS() || V.F[0]; otherPx = null; otherName = null; if (!f) return;
  const [ex, ey] = f.exp, n = V.n; let best = -Infinity, bx = 0, by = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = f.d[y * n + x]; if (v == null || Math.hypot(x - ex, y - ey) < 5) continue; if (v > best) { best = v; bx = x; by = y; } }
  otherPx = [bx, by];
  const [ra, dec] = gridToWorld(V.grid, bx, by);
  simbadCone(ra, dec, 15 / 3600, { limit: 5, timeoutMs: 10000 }).then(rows => {
    const o = rows.map(r => ({ ...r, s: separationArcsec(ra, dec, r.ra, r.dec) })).sort((a, b) => a.s - b.s)[0];
    otherName = o ? { name: o.name, type: otypeName(o.otype), sep: o.s } : false;
  }).catch(() => { otherName = false; });
}
function placeHits() {
  const show = scene === 'viewer' && mode === 'play' && V.F.length > 0; ['hitStar', 'hitOther'].forEach(id => { $(id).hidden = !show; });
  if (!show) return;
  const f = V.F[Math.min(P.i, V.F.length - 1)], rad = 2.2 * cssCell, [ex, ey] = f.exp;
  Object.assign($('hitStar').style, { left: ((ex + .5) * cssCell - rad) + 'px', top: ((ey + .5) * cssCell - rad) + 'px', width: 2 * rad + 'px', height: 2 * rad + 'px' });
  $('hitOther').hidden = !otherPx; if (!otherPx) return;
  const [ox, oy] = otherPx, rr = 1.5 * cssCell;
  Object.assign($('hitOther').style, { left: ((ox + .5) * cssCell - rr) + 'px', top: ((oy + .5) * cssCell - rr) + 'px', width: 2 * rr + 'px', height: 2 * rr + 'px' });
}
bindTip($('hitStar'), () => `<b>${esc(V.name)}</b><small>${V.target?.pmra || V.target?.pmdec ? 'Inside the dashed ring (predicted position)' : 'Centre of the patch'}</small>`);
bindTip($('hitOther'), () => otherName ? `<b>${esc(otherName.name)}</b><small>${esc(otherName.type)} · SIMBAD, ${otherName.sep.toFixed(0)}″ from the bright spot</small>`
  : otherName === false ? '<b>Unidentified source</b><small>No SIMBAD object within 15″ of this bright spot.</small>' : '<b>Looking it up…</b><small>Asking SIMBAD</small>');

/* ---------- scenes: map → (zoom) → flip-book ---------- */
function toViewer(instant) {
  const go = () => { scene = 'viewer'; app.dataset.scene = 'viewer'; hideTip(); layout(); onFrame(P.i); placeHits(); GH.placeMap(); if (innerWidth < 1100) sheet(false); updateURL(); };
  if (!instant && document.startViewTransition && !set.motion) document.startViewTransition(go); else go();
}
function toMap(instant) {
  const go = () => { scene = 'map'; app.dataset.scene = 'map'; P.pause(); clearInterval(bt); hideTip(); closePop(); GH.syncKey(); GH.renderCD(); requestAnimationFrame(GH.placeMap); requestAnimationFrame(placeOverlays); updateURL(); if (M.sel) setCoordText(M.sel.ra, M.sel.dec); };
  if (!instant) Snd.play('tick');
  if (!instant && document.startViewTransition && !set.motion) document.startViewTransition(go); else go();
}
function playPatch() {
  const s = M.sel; if (!s) return;
  Snd.play('click');
  const t = s.t, preset = t?.preset;
  const query = preset ? { type: 'name', name: preset.label } : t?.simbad ? { type: 'name', name: t.simbad.name } : { type: 'coords', ra: s.ra, dec: s.dec };
  const same = V.query && JSON.stringify(V.query) === JSON.stringify(query) && V.status === 'ready';
  if (skymap.aladin && !set.motion) skymap.setFov(Math.max(0.05, (150 / 3600) / 0.42));
  setTimeout(() => { toViewer(false); if (!same) load(query, t ? t.name : 'this patch'); }, set.motion ? 0 : 250);
}
$('cdPlay').onclick = playPatch; $('mdPlay').onclick = playPatch; $('mapBack').onclick = () => toMap(false);

/* ---------- map colour (wavelength) ---------- */
function setWl(ch) { skymap.setChannel(ch); const um = CHANNEL_UM[ch].toFixed(2) + ' µm'; $('wlOut').textContent = um; $('mapWl').textContent = um; }
$('wl').addEventListener('input', e => setWl(+e.target.value));

/* ---------- shareable URL: ?q= or ?ra=&dec=, plus &scene=viewer ---------- */
function updateURL() {
  const p = new URLSearchParams(), s = M.sel;
  if (s?.t?.preset) p.set('q', s.t.preset.label); else if (s?.t?.simbad) p.set('q', s.t.simbad.name); else if (s) { p.set('ra', s.ra.toFixed(5)); p.set('dec', s.dec.toFixed(5)); }
  if (scene === 'viewer') p.set('scene', 'viewer');
  const url = location.pathname + (p.toString() ? '?' + p : '');
  if (url !== location.pathname + location.search) history.replaceState(null, '', url);
}

/* ---------- start ---------- */
window.__app = { skymap, V, M }; // debugging hook (read-only use)
function init() {
  $('pins').innerHTML = TARGETS.map(t => `<button class="pin" data-k="${t.key}" aria-label="${esc(t.name)}, ${esc(t.id)}"></button>`).join('');
  pinEls = [...$('pins').querySelectorAll('.pin')];
  pinEls.forEach((p, i) => { const t = TARGETS[i]; bindTip(p, () => `<b>${esc(t.name)}</b><small>${esc(t.id)}</small>`); p.onclick = () => select(t.ra, t.dec, t, true); });
  $('pins').style.cssText = 'position:absolute;inset:0;pointer-events:none'; pinEls.forEach(p => { p.style.pointerEvents = 'auto'; });
  $('sel').hidden = true;
  app.dataset.scene = 'map';
  applySettings(); buildTimeline(); layout();
  const qp = new URLSearchParams(location.search);
  if (qp.get('ghost') !== null && Number.isFinite(+qp.get('ghost'))) GH.G.pending = { years: +qp.get('ghost'), viewer: qp.get('scene') === 'viewer' };
  const first = TARGETS[0];
  skymap.init(first.ra, first.dec, 10).catch(() => { mapFailed(); }).then(() => { if (!skymap.aladin) return;
    setWl(+$('wl').value); applyMapBands(); placeOverlays(); setTimeout(placeOverlays, 800);
    if (qp.get('q') || (qp.get('ra') && qp.get('dec'))) {
      const text = qp.get('q') || `${qp.get('ra')} ${qp.get('dec')}`; $('q').value = text;
      goTo(text).then(() => { if (qp.get('scene') === 'viewer') setTimeout(playPatch, 400); });
    } else select(first.ra, first.dec, first, false);
  });
  const ro = new ResizeObserver(() => { layout(); ['viewSeg', 'speedSeg', 'layerSeg'].forEach(id => segSelect($(id), b => b.getAttribute('aria-pressed') === 'true')); refraction(); placeOverlays(); setTimeout(placeOverlays, 120); setTimeout(placeOverlays, 600); });
  ro.observe($('screens')); ro.observe($('dock')); ro.observe($('insp')); ro.observe($('topbar')); ro.observe($('mapWrap'));
}
init();
