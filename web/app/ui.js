// Live site controller for DESIGN.md v2 (direction E). UI behaviours (Clarity, sound, popovers,
// timeline, band editor, tooltips, refraction, glare) follow the Design Studio prototype;
// data comes from the real pipeline (IRSA via our local relay, SIMBAD) and the sky map is
// Aladin Lite showing the SPHEREx DR1 all-sky map.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { parseQuery, QueryError, DEFAULT_SETTINGS } from './query.js';
import { run, buildStacks, measureMotion, resolveTarget, motionMeasurability, motionDetectors, detectorText } from './data.js';
import { kinematics, tangentialVelocity, toLSR, totalPM } from './kinematics.js';
import { PRESETS, findPreset } from './presets.js';
import { toGalactic, toEcliptic, constellation, loadConstellations, visibleTonight, altAz, riseTransitSet, skyTonight, tonightWords, dirWord } from './sky.js';
import { simbadCone, otypeName, CHANNEL_UM } from './skymap.js';
import { Sky3D as SkyMap } from './sky3d/index.js'; // 3D celestial sphere (three.js); same interface as the Aladin SkyMap
import { layersFor, DEFAULT_BANDS, bandLabel, bandName, bandInitials, BAND_NOTE } from './bands.js';
import { notebookAdd, openNotebook } from './notebook/notebook.js'; // Lab notebook: "+" keys in the info panel
import { listImages } from '../core/irsa.js';
import { isExpert } from './expert.js';
import { propagate, separationArcsec, mjdToDate } from '../core/motion.js';
import { gridToWorld } from '../core/align.js';
import { createContam } from './contam-ui.js';
import { ringObject, ringAt } from './ringobj.js';
import { seeItWith } from './seeit.js'; // can you actually see it (V magnitude), apart from 'is it up' // whose dashed ring, and where (patch bug, Sun 15 Nov)
import { createGhost } from './ghost-ui.js';
import { createLightcurve } from './lightcurve/index.js'; // brightness-vs-date strip (info panel)
import { createCleanBlink } from './cleanblink.js'; // Blink: hide overlays, zoom on the star
import { createTelescopes } from './telescopes/index.js'; // Telescope compare (DESIGN.md 31a)
import { CLARITY_KEY, readClarity } from './prefs.js'; // Clarity defaults (sounds off)
import './story.js'; // b1: first-screen story on the cold-open map (story.css)
import { motionVerdict, paDelta } from './proof/logic.js'; // the Proof page's verdict rule, for the result plate
import { groupOfDet, groupByDets, centreMasked, bestGroup, counterText, plannedIndexOf, resultState, storyCaption, shareParams, verdictClass, VIEW_MODES } from './viewerbits.js';

const R = window.MockRender;
const $ = id => document.getElementById(id), root = document.documentElement;
const mq = q => matchMedia(q).matches;
const BASE = location.origin;
const NOW_MJD = 61360; // mid-Nov 2026: where moving stars are "now" on the map
const SETTINGS = { ...DEFAULT_SETTINGS, fov: 2.5, max: 120, band: 'all' }; // 150″ cutouts (DESIGN.md)
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let tables = null;
let nbInfo = null; // the image the "This image" panel shows now (for its notebook "+" keys)
// load() waits for the wavelength tables, so a deep link (?q=…&scene=viewer) never runs with tables = null
const tablesReady = fetch('core/data/spectral_wcs.json').then(r => r.json()).then(t => { tables = t; }).catch(() => {});
loadConstellations().then(() => { if (M.sel) renderCD(); }).catch(() => {}); // fill in the Constellation row once it can

/* ---------- Clarity settings (remembered, default from the OS) ---------- */
const KEY = CLARITY_KEY; // sounds are off until the visitor turns them on (prefs.js)
const set = readClarity((() => { try { return localStorage.getItem(KEY); } catch { return null; } })(),
  { reduceMotion: mq('(prefers-reduced-motion: reduce)'), reduceTransparency: mq('(prefers-reduced-transparency: reduce)'), moreContrast: mq('(prefers-contrast: more)') });
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
    if (!set.sounds || !this.ctx) return; const now = performance.now();
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
  query: null, target: null, grid: null, n: 25, raws: [], F: [], FA: [], FK: [], /* FA = every frame, FK = the ones the flag filter keeps, F = the ones shown (FK, or one band of it while Hold one band is on) */ stacks: [], planned: 0, plannedMjds: [], failed: 0, retries: 0,
  status: 'idle', ctl: null, motion: null, seasons: [], name: '',
};
const iso = d => d.toISOString().slice(0, 19);
// exp = where the ring goes on the grid; ringOff = no ring on this image (empty patch, or the named star is off the image)
const ringFor = (expected, mjd) => { if (!V.ring) return { exp: [V.grid.c, V.grid.c], ringOff: true }; if (V.ring.own) return { exp: expected || [V.grid.c, V.grid.c], ringOff: false };
  const p = ringAt(V.grid, V.ring, mjd); return p ? { exp: p, ringOff: false } : { exp: [V.grid.c, V.grid.c], ringOff: true }; };
const toF = f => ({ mjd: f.mjd, date: f.date, det: f.detector, um: f.wavelengthUm, ...ringFor(f.expected, f.mjd),
  d: Array.from(f.data, v => (Number.isFinite(v) ? v : null)), obs: f.obsid, raw: f });
const stackToF = s => ({ mjd: s.mjd, date: `${iso(s.startDate)} to ${iso(s.endDate)}`, det: 'stack', um: null, ...ringFor(s.expected, s.mjd),
  d: Array.from(s.data, v => (Number.isFinite(v) ? v : null)), count: s.count, start: s.startDate, end: s.endDate });
const seasonName = v => { const a = new Date(V.F[v.from].date.slice(0, 10)), b = new Date(V.F[v.to].date.slice(0, 10));
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) return `${MON[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  return `${MON[a.getUTCMonth()]}${a.getUTCFullYear() !== b.getUTCFullYear() ? ' ' + a.getUTCFullYear() : ''}–${MON[b.getUTCMonth()]} ${b.getUTCFullYear()}`; };
// observing seasons: SPHEREx revisits a spot about every 6 months; visits < 60 days apart are one season
const visits = (F) => { const out = []; let cur = null; F.forEach((f, i) => { if (!cur || f.mjd - F[i - 1].mjd > 60) { cur = { from: i, to: i }; out.push(cur); } else cur.to = i; }); return out; };
const seasonOf = i => V.seasons.findIndex(v => i >= v.from && i <= v.to);

/* "Hold one band" (judging panel a3/b3): Time playback shows one detector pair only, so the star
   doesn't flicker between wavelengths. Default on for a preset (presets.js holdBand); the motion fit,
   the brightness strip and the counts still use every image the flag filter keeps (V.FK).
   AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026. */
const HOLD = { on: false, group: null, note: '' };
const shownFrames = () => (HOLD.on && HOLD.group ? V.FK.filter(f => HOLD.group.dets.includes(f.det)) : V.FK);
const holdPreset = () => (V.query?.type === 'name' ? findPreset(V.query.name) : null);
function holdForLoad() { // at the start of a load: the preset's band, else off
  const p = holdPreset(), g = groupByDets(p?.holdBand);
  Object.assign(HOLD, g ? { on: true, group: g, note: p.holdNote || '' } : { on: false, group: null, note: '' });
}
function setHold(on) {
  if (on && !HOLD.group) { // no preset band: the pair whose images most often show the centre unblanked
    const b = bestGroup(V.FK.map(f => ({ det: f.det, masked: centreMasked(f.d, V.n, f.exp[0], f.exp[1]) })));
    if (!b) { toast('Not enough images in any one band yet.'); Snd.play('error'); return; }
    HOLD.group = b.group; HOLD.note = `its centre is blanked least often here (${b.masked} of ${b.n} images)`;
  }
  HOLD.on = !!on;
  const cur = V.F[P.i]; V.F = shownFrames();
  if (cur && V.F.length) { let b = 0; V.F.forEach((f, k) => { if (Math.abs(f.mjd - cur.mjd) < Math.abs(V.F[b].mjd - cur.mjd)) b = k; }); P.i = b; } else P.i = 0;
  if (V.status === 'ready') { restack(); if (mode !== 'play' && mode !== 'telescopes' && V.stacks.length < 2) setMode('play'); }
  shown = -1; buildTimeline(); holdKey(); updatePlate(); draw(); onFrame(P.i);
  Snd.play('tick');
}
function holdKey() {
  const k = $('holdKey'); if (!k) return;
  k.setAttribute('aria-pressed', String(HOLD.on));
  k.querySelector('.hk-l').textContent = HOLD.on && HOLD.group ? HOLD.group.label : 'All bands';
  k.title = HOLD.on ? `Playing one band only (detectors ${HOLD.group.dets.join('–')}). Click to show all bands.` : 'Playing every band. Click to hold one band, so the star doesn\'t flicker between wavelengths.';
}

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
    hidden.map(f => `<i class="tick hid" style="left:${pos(f.mjd)}%" title="${esc(CX.whyHidden(f) ? 'Hidden: ' + CX.whyHidden(f) : V.FK.includes(f) && HOLD.on ? `Another band (showing ${HOLD.group.label} only)` : 'Hidden: flag filter')}"></i>`).join('') + '<span class="key thumb" id="thumb"></span>';
  $('tlLabels').innerHTML = V.seasons.map(v => `<span style="left:${(pos(F[v.from].mjd) + pos(F[v.to].mjd)) / 2}%">${seasonName(v)}</span>`).join('');
  ticks = [...track.querySelectorAll('.tick:not(.pending):not(.hid)')];
  const g = document.createElement('span'); g.className = 'ghost'; g.innerHTML = '<b></b>'; track.appendChild(g);
  track.setAttribute('aria-valuemax', String(Math.max(1, F.length)));
  applyRanges();
  LC.data(V.FK.map(f => f.raw), V.grid, V.name, V.status === 'loading'); // brightness strip: every image the flag filter keeps (all bands, also while one band is held)
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
const opt = cv => CB.opt({ ramp: set.ramp, cell: +cv.dataset.dev, ring: set.ring && !!V.ring, ringColor: getComputedStyle(root).getPropertyValue('--ring').trim(),
  maskBg: '#211b16', maskInk: '#6b5d50', stretch: set.str, hatch: set.hatch });
function cross(cv, fx, fy) {
  if (CB.on && mode === 'blink') return; // Clean Blink hides the cross (Compare always draws it: its chip says so)
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
  if (!f) { ['d-date', 'd-time', 'd-det', 'd-um', 'd-band', 'd-mask', 'd-mjd'].forEach(id => { $(id).textContent = '—'; }); $('d-band').title = ''; nbInfo = null; return; }
  const st = f.det === 'stack';
  $('d-date').textContent = st ? sRange(f) : R.fmtDate(f.date);
  $('d-time').textContent = st ? `season stack of ${f.count}` : f.date.slice(11, 16) + ' UTC';
  $('d-det').textContent = st ? 'mixed' : 'D' + f.det;
  $('d-um').textContent = f.um ? f.um.toFixed(2) + ' µm' : 'mixed, combined';
  const bl = bandLabel(rangeOf(f.um)); // a wavelength range, never a finding (bands.js)
  $('d-band').textContent = bl ? bl.text.replace(/ µm$/, ' µm') : st ? 'mixed (stacked)' : 'outside your bands'; $('d-band').title = bl ? bl.tip : '';
  nbInfo = f;
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
  $('chip').title = ''; $('flag').textContent = ''; // set again below for the view that needs them
  if (mode === 'play' || V.stacks.length < 2) {
    const f = F[Math.min(P.i, F.length - 1)]; CX.drawStage(A, f, V.n, opt(A), true); GH.drawCanvas(A, f, +A.dataset.dev); info(f);
    const rg = rangeOf(f.um), bl = bandLabel(rg); // "CO₂-ice band · 3.82–4.42 µm": a range, not a detection
    $('chip').title = bl ? bl.tip : '';
    $('chip').innerHTML = CX.chipLead() + (HOLD.on ? `<b class="hold-g" title="Hold one band is on: only detectors ${HOLD.group.dets.join('–')} play">${HOLD.group.label} only</b><span class="sep">·</span>` : '') + `${bl ? `<i class="sw" style="--rc:${rg.c}"></i><span>${esc(bl.name)}</span><span class="sep bl-r">·</span><span class="bl-r">${bl.range}</span><span class="sep">·</span>` : ''}<span>λ ${f.um ? f.um.toFixed(2) : '?'} µm</span><span class="sep bl-d x-only">·</span><span class="bl-d x-only">D${f.det}</span><span class="sep">·</span><span>${R.fmtDate(f.date)}</span>`;
    A.setAttribute('aria-label', `SPHEREx infrared image of ${V.name}, ${R.fmtDate(f.date)}, ${f.um ? f.um.toFixed(2) + ' micrometres' : ''}`);
  } else if (mode === 'compare') {
    CX.drawStage(A, firstS(), V.n, opt(A)); cross(A, ex[0], ex[1]); $('capA').innerHTML = `<b>First season</b> · stacked · ${sRange(firstS())}`;
    CX.drawStage(B, lastS(), V.n, opt(B)); cross(B, ex[0], ex[1]); $('capB').innerHTML = `<b>Last season</b> · stacked · ${sRange(lastS())}`;
    $('chip').innerHTML = CX.chipLead() + '<span>Cross = where the star was in the first season</span>'; info(lastS(), 'Right: last season');
  } else {
    const f = side ? lastS() : firstS(); CX.drawStage(A, f, V.n, opt(A)); cross(A, ex[0], ex[1]);
    // One label, replaced on every flip: the season sits in the chip itself (the old separate #flag pill
    // was drawn over the chip on narrow stages, so the two labels read as one bleeding into the other).
    $('chip').innerHTML = CX.chipLead() + `<b>${side ? 'Last season' : 'First season'}</b><span class="sep bl-st">·</span><span class="bl-st">stacked</span><span class="sep">·</span><span>${sRange(f)}</span>`;
    info(f, side ? 'Last season (stacked)' : 'First season (stacked)');
  }
}
let tickAnim = null;
function setCounter(i, animate) {
  // "6 / 120 · 84 loaded" while loading, "15 / 120 (of 358)" when done, "5 / 47" with one band held (viewerbits.js)
  const N = V.F.length, fmt = k => counterText({ i: k, shown: N, loading: V.status === 'loading', planned: V.planned, loaded: V.FA.length,
    total: V.total, held: HOLD.on, plannedIndex: plannedIndexOf(V.plannedMjds, V.F[k]?.mjd) });
  cancelAnimationFrame(tickAnim);
  $('counter').title = HOLD.on ? `Image number in this band (${HOLD.group.label}); ${V.FK.length} images in all bands` : V.status === 'loading' ? `Image number out of the ${V.planned} being loaded` : `Image number out of the ${N} used${V.total > N ? `; IRSA has ${V.total} images of this spot, spread evenly over time we use ${N}` : ''}`;
  if (!N) { $('counter').textContent = fmt(0); return; }
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
  const rg = rangeOf(f.um); // the coloured tick under the thumb, named in words (colour is never the only cue)
  $('tlDate').innerHTML = (rg ? `<span class="tl-band" title="${esc(bandLabel(rg).text)}"><i style="--rc:${rg.c}"></i><span class="tlb-n">${esc(bandName(rg))}</span><span class="tlb-i" aria-hidden="true">${esc(bandInitials(rg))}</span></span>` : '') + `<span>${R.fmtDate(f.date)}</span>`;
  track.setAttribute('aria-valuenow', i + 1); track.setAttribute('aria-valuetext', `Image ${i + 1}, ${R.fmtDate(f.date)}${rg ? ', ' + bandName(rg) : ''}`);
  setCounter(i, manual);
  { const k = V.FK.indexOf(f); if (k >= 0) LC.mark(k); } // the strip lists every kept image, all bands
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
const CX = createContam({ $, R, V, P, esc, set, Snd, base: BASE, tables: () => tables, rangeOf: um => namedRange(rangeOf(um)), segSelect,
  mode: () => mode, redraw: () => { draw(); }, refilter: () => refilter(), stackRaws: () => V.F.map(f => f.raw).sort((a, b) => a.mjd - b.mjd),
  closePop: () => closePop(), hideTip: () => hideTip(),
  tipAt: (html, x, y) => { clearTimeout(tipT); $('tip').innerHTML = html; placeTip({ left: x - 10, right: x + 10, top: y - 10, height: 20 }); } });
// Brightness-vs-date strip (lightcurve/) and Clean Blink (cleanblink.js)
const LC = createLightcurve({ $, esc, colourOf: um => rangeOf(um)?.c,
  onPick: i => { if (mode === 'compare' || mode === 'blink') setMode('play'); P.pause(); const f = V.FK[i]; if (f && !V.F.includes(f)) setHold(false); P.set(Math.max(0, V.F.indexOf(f)), true); Snd.play('scrub'); } });
const CB = createCleanBlink({ $, Snd, mode: () => mode, n: () => V.n, cell: () => cssCell, redraw: () => draw(),
  getView: () => ({ zoom, panX, panY }), setView: v => { zoom = v.zoom; if (v.panX != null) { panX = v.panX; panY = v.panY; } layout(); },
  target: () => (firstS()?.exp && lastS()?.exp ? [firstS().exp, lastS().exp] : null) });
function restack() { V.stacks = V.F.length ? buildStacks(V.F.map(f => f.raw).sort((a, b) => a.mjd - b.mjd)).map(stackToF) : []; }
// Measure the motion from the images the flag filter keeps (also with no catalogue motion, e.g. a
// coordinate search). Runs when loading finishes and again whenever the filter changes.
function remeasure() {
  // A preset may say which detectors its motion is measured on (WISE 0855: 5–6, where it shows);
  // the Proof page uses the same images (data.js motionDetectors).
  const preset = V.query?.type === 'name' ? findPreset(V.query.name) : null, dets = motionDetectors(preset);
  const raws = V.FK.map(f => f.raw).filter(f => !dets || dets.includes(f.detector)); // every kept image, whatever band is held
  try { V.motion = V.grid && raws.length ? measureMotion(raws, V.grid) : null; } catch { V.motion = null; }
  if (V.motion) V.motion.detectors = dets;
  // only a final fit counts: all planned images tried and at least two observing seasons
  if (V.motion?.ok && visits(V.FK).length < 2) V.motion = { ok: false, frames: V.motion.frames, reason: 'one season only', detectors: dets };
  const mc = motionCheck(), mo = V.motion;
  const fitted = mo?.ok && !(mc && !mc.measurable) && mo.significant !== false; // a real, significant motion: Simple gets words, Expert ± numbers
  if (fitted) $('d-meas').innerHTML = `<span class="x-only">${(mo.total / 1000).toFixed(2)} ± ${(mo.totalErr / 1000).toFixed(2)}″/yr</span><span class="s-only">moves about ${plainArcsec(mo.total / 1000)} a year</span> · ${esc(usedText(mo))}`;
  else $('d-meas').textContent = mo?.ok
    ? (mc && !mc.measurable ? `not measurable here (${mc.saturated ? 'centre saturated' : mc.slow ? 'moves under a pixel' : 'no fit'})`
      : `no significant motion (< ${(mo.upperLimit / 1000).toFixed(2)}″/yr)`)
      + ` · ${usedText(mo)}`
    : mo ? (mo.reason === 'one season only' ? 'needs two seasons to measure' : mo.reason === 'too few frames' ? 'too few images to measure' : 'too faint to measure') : '—';
  $('useAll').hidden = !filterHides(mo);
  repaintMot?.();
  updatePlate();
}

/* ---------- Result plate (judging panel a6 + b2; design/spec-judge-fixes.md section 2) ----------
   Under the image (desktop) or first in the dock (phone): one caption line, then the measured chip:
   "Measuring motion… 45/120", then "Measured here 10.32 ± 0.27″/yr · catalogue 10.39 · AGREES · How we know →".
   The numbers are the motion panel's fit (V.motion), the same numbers in Simple and Expert; the verdict is
   the Proof page's rule (proof/logic.js motionVerdict) with the Proof page's catalogue value (proof.json).
   AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026. */
let proofCat = null; // preset key -> proof.json catalogue motion { value, err, pa, source }
fetch('data/proof.json').then(r => r.json()).then(d => {
  proofCat = {}; for (const t of d.targets || []) { const m = (t.tests || []).find(x => x.type === 'motion'); if (m?.expected) proofCat[t.key] = m.expected; }
  updatePlate();
}).catch(() => { proofCat = {}; });
function catalogueMotion() { // { value, err (mas/yr), vec: { pmra, pmdec }, source } or null
  const p = holdPreset(), pc = p && proofCat?.[p.key];
  if (pc && Number.isFinite(pc.value)) {
    const pa = (pc.pa ?? 0) * Math.PI / 180;
    // the arrow: the preset's own SIMBAD/Gaia pmra, pmdec (unrounded, as on Proof); else from proof.json's rounded PA
    const tv = p.target && Number.isFinite(p.target.pmra) && Number.isFinite(p.target.pmdec) ? { pmra: p.target.pmra, pmdec: p.target.pmdec } : null;
    return { value: pc.value, err: pc.err || 0, vec: tv || (Number.isFinite(pc.pa) ? { pmra: pc.value * Math.sin(pa), pmdec: pc.value * Math.cos(pa) } : null), source: pc.source || '' };
  }
  const t = V.target; if (!t || !(t.pmra || t.pmdec)) return null;
  return { value: totalPM(t.pmra, t.pmdec), err: 0, vec: { pmra: t.pmra, pmdec: t.pmdec }, source: t.source || '' };
}
const NM_WHY = (mc, mo) => (mc?.saturated ? `centre blanked in ${mo.maskedFrames} of ${mo.frames} images` : mc?.slow ? `moves under one pixel in these ${mo.span.toFixed(1)} years` : 'the fit could not run');
const FAIL_WHY = { 'one season only': 'needs two seasons of images', 'too few frames': 'too few images' };
let plateKey = '';
function updatePlate() {
  const el = $('resultPlate'); if (!el) return;
  if (V.stalled || V.status === 'error' || V.status === 'empty') { el.hidden = true; plateKey = ''; return; } // the stage's own message speaks
  const loading = V.status === 'loading', mo = V.motion, p = holdPreset();
  const how = `<a class="rp-how" href="proof.html${p ? '#' + p.key : ''}">How we know <span aria-hidden="true">→</span></a>`, sep = '<span class="sep">·</span>';
  let res = '', live = '', done = false, cap = '', capCat = '';
  if (loading || V.status === 'idle') {
    const n = V.FA.length, N = V.planned || 0, pc = N ? Math.round(100 * n / N) : 0;
    res = `<span class="rp-k">Measuring motion…</span> <span class="rp-n">${n}/${N || '…'}</span>`; el.style.setProperty('--p', pc + '%');
  } else if (V.status === 'ready') {
    done = true;
    const cat = catalogueMotion(), mc = motionCheck();
    const vr = mo?.ok && cat ? motionVerdict(mo, cat.value, cat.err, mo.span, cat.vec) : null, v = vr?.verdict ?? null;
    // direction (Proof's own chip, a7): shown only when it is not "DIRECTION AGREES", so the viewer is never more confident than Proof
    const dir = mo?.significant !== false && vr?.direction && vr.direction.verdict !== 'DIRECTION AGREES' ? vr.direction : null;
    const dirTxt = dir && cat?.vec ? (() => { const pm = (Math.atan2(mo.pmra, mo.pmdec) * 180 / Math.PI + 360) % 360, pc = (Math.atan2(cat.vec.pmra, cat.vec.pmdec) * 180 / Math.PI + 360) % 360;
      return `direction ${Math.abs(paDelta(+pm.toFixed(1), +pc.toFixed(1))).toFixed(1)}° off (${pm.toFixed(1)}° vs ${pc.toFixed(1)}°)`; // from the shown angles })() : '';
    const st = resultState({ mo, measurable: mc ? mc.measurable : true, verdict: v, catYr: cat ? cat.value / 1000 : null });
    const tag = vv => `<span class="rp-v ${verdictClass(vv)}">${vv}</span>`;
    if (st.kind === 'fail') { res = `<span class="rp-k">Motion can't be measured here:</span> ${esc(FAIL_WHY[st.reason] || 'too faint to follow')} ${sep} ${how}`; live = `Motion can't be measured here: ${FAIL_WHY[st.reason] || 'too faint to follow'}.`; }
    else if (st.kind === 'nm') { res = `<span class="rp-k">Motion can't be measured here:</span> ${esc(NM_WHY(mc, mo))} ${sep} ${tag('NOT MEASURABLE')} ${sep} ${how}`; live = `Motion can't be measured here: ${NM_WHY(mc, mo)}. Not measurable.`; }
    else {
      res = `<span class="rp-k">Measured here</span> <b>${st.value}</b><span class="brk"></span>${st.cat != null ? ` ${sep} <span class="rp-k">catalogue</span> ${st.cat.toFixed(2)}` : ''}${st.verdict ? ` ${sep} ${tag(st.verdict)}` : ''}`
        + (dirTxt ? `<span class="rp-row"></span><span class="rp-k">${esc(dirTxt)}</span> ${sep} <span class="rp-v ${dir.verdict === 'DIRECTION OFF' ? 'differs' : 'limit'}" title="${dir.sigma.toFixed(1)}σ">${dir.verdict}</span>` : '') + ` ${sep} ${how}`;
      live = `Measured here ${st.value}${st.cat != null ? `, catalogue ${st.cat.toFixed(2)}″ a year` : ''}${st.verdict ? `, ${st.verdict.toLowerCase()}` : ''}${dirTxt ? `; ${dirTxt}, ${dir.verdict.toLowerCase()}` : ''}.`;
    }
    // b2 caption: preset, measured, significant motion; numbers from the fit over the first-to-last stack dates
    if (p && st.kind === 'value' && mo.significant !== false && V.stacks.length > 1) {
      const c = storyCaption(V.name, mo, firstS().mjd, lastS().mjd);
      if (c) { cap = esc(c.text); if (cat) capCat = ` ${/gaia/i.test(cat.source) ? 'Gaia' : 'The catalogue'} says ${(cat.value / 1000).toFixed(2)}″/yr.`; }
    }
  }
  // the caption slot: the Blink/Compare story, or in Time playback which band is held
  const story = (mode === 'blink' || mode === 'compare') && cap;
  const holdLine = mode === 'play' && HOLD.on && V.F.length ? `Showing ${HOLD.group.label}: ${esc(HOLD.note)}. <button type="button" class="rp-all" data-hold-off>Show all bands</button>` : '';
  const capHTML = story ? `${cap}<span class="rp-cat">${esc(capCat)}</span>` : holdLine;
  const key = [res, capHTML, done].join('|'); if (key === plateKey) return; plateKey = key;
  el.classList.toggle('done', done); el.classList.toggle('measuring', !done); el.classList.toggle('two', res.includes('rp-row'));
  $('rpCap').innerHTML = capHTML; $('rpCap').hidden = !capHTML;
  const r = $('rpRes');
  if (r.dataset.done !== String(done) && done && !set.motion) { r.classList.add('swap'); setTimeout(() => r.classList.remove('swap'), 170); }
  r.dataset.done = String(done); r.innerHTML = res;
  if (live && $('rpLive').textContent !== live) $('rpLive').textContent = live; else if (!done) $('rpLive').textContent = '';
  el.hidden = false;
}
document.addEventListener('click', e => { if (e.target.closest('[data-hold-off]')) setHold(false); });
// phone: the plate is the first block of the dock; wider: on the stage under the image
{ const ph = matchMedia('(max-width: 699px)'), place = () => { const el = $('resultPlate'); if (!el) return;
    if (ph.matches) $('dock').prepend(el); else $('stage').appendChild(el); };
  place(); ph.addEventListener('change', place); }
// Master item 11: the default flag filter hides nothing, so by default the fit uses the same images as Proof.
// When the user's saved filter hides some, say "from 108 of 120 images (your flag filter)" and offer
// "Use all images (as on Proof)". AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
const fitPool = mo => V.FA.filter(f => !mo?.detectors || mo.detectors.includes(f.det)).length; // images the fit could use
const filterHides = mo => !!(mo?.ok && V.FA.length > V.FK.length && fitPool(mo) > mo.frames);
const usedText = (mo, dets = true) => `${filterHides(mo) ? `from ${mo.frames} of ${fitPool(mo)} images (your flag filter)` : `from ${mo.frames} images`}${dets && mo.detectors ? `, detectors ${detectorText(mo.detectors)}` : ''}`;
const USE_ALL = '<button type="button" class="fl-link use-all" data-use-all>Use all images (as on Proof)</button>';
function useAllImages() {
  CX.clearHide(); // keeps the shown-flag choices, drops the saved hide list
  refilter(); if (openPop?.pop.id === 'flagsPop') CX.renderPop();
  Snd.play('confirm'); toast(`All ${V.FA.length} images are used again, as on the Proof page.`);
}
document.addEventListener('click', e => { if (e.target.closest('[data-use-all]')) useAllImages(); });
// The shared measurability rule (data.js motionMeasurability, also on the Proof page) for the
// current fit: catalogue motion from the loaded target (none for a coordinate patch).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
function motionCheck() {
  const mo = V.motion; if (!mo?.ok) return null;
  const t = V.target, cat = t && (t.pmra || t.pmdec) ? totalPM(t.pmra, t.pmdec) : null;
  return motionMeasurability(mo, { catalogueMasYr: cat });
}
// Plain words for a not-measurable fit: { head, note } (head = the row value, note = the detail).
function notMeasurableText(mc, mo) {
  const all = mo.maskedFrames === mo.frames;
  const satHead = `the star's centre is saturated in ${all ? 'every image' : `${mo.maskedFrames} of the ${mo.frames} measured images`}`;
  const t = V.target, catYr = t && (t.pmra || t.pmdec) ? totalPM(t.pmra, t.pmdec) / 1000 : null;
  const slowTxt = mc.slow && catYr != null ? `its catalogue motion, ${catYr.toFixed(2)}″/yr, moves it only ${mc.shiftPx.toFixed(3)} of a 6.15″ pixel over these ${mo.span.toFixed(1)} years` : '';
  // the fit's number is Expert detail; Simple keeps the plain sentence (and the honest "not a real motion")
  const fitNum = `${(mo.total / 1000).toFixed(2)} ± ${(mo.totalErr / 1000).toFixed(2)}″/yr`;
  const fitTxt = mo.significant !== false ? `<span class="x-only">${fitNum}</span><span class="s-only">small apparent motion</span>` : `no significant motion<span class="x-only"> (&lt; ${(mo.upperLimit / 1000).toFixed(2)}″/yr)</span>`;
  if (mc.saturated) return { head: `Not measurable here: ${satHead}`,
    note: `So every position comes from the edges of a blanked core${mo.significant !== false ? `, and the fit's ${fitTxt} from ${mo.frames} images is not a real motion` : ''}.${slowTxt ? ` Also, ${slowTxt}.` : ''}` };
  if (mc.slow) return { head: `Not measurable here: ${slowTxt.replace(/^its/, 'the')}`,
    note: mo.significant !== false ? `The fit gives <span class="s-only">a </span>${fitTxt} from ${mo.frames} images, which is not a real motion: a star this slow should show none.` : `As expected, the ${mo.frames} images show ${fitTxt}.` };
  return { head: 'Not measurable here: the fit could not run', note: '' };
}
// Re-apply the "hide images with…" filter, keeping the current image (or the nearest one in time).
function refilter() {
  const cur = V.F[P.i]; V.FK = CX.filter(V.FA); V.F = shownFrames();
  if (cur && V.F.length) { let b = 0; V.F.forEach((f, k) => { if (Math.abs(f.mjd - cur.mjd) < Math.abs(V.F[b].mjd - cur.mjd)) b = k; }); P.i = b; } else P.i = 0;
  if (V.status === 'ready') { restack(); remeasure(); if (mode !== 'play' && mode !== 'telescopes' && V.stacks.length < 2) setMode('play'); }
  if (!V.FK.length && V.FA.length) toast('Every image is hidden by the flag filter. Untick a box under FLAGS to bring them back.');
  buildTimeline(); // sets V.seasons for the count below
  $('d-n').textContent = countText();
  onFrame(P.i);
}
// The "Images" line (Master item 1): up to SETTINGS.max images spread evenly over time out of all IRSA found
// (data.js spread()), then what the user's flag filter hides and what failed.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
function countText() {
  const got = V.FA.length, hid = got - V.FK.length, s = visits(V.FK).length;
  const head = V.planned < V.total ? `${got} of ${V.total} images used (spread evenly over time to keep it quick)`
    : V.failed ? `${got} of ${V.total} images used` : `All ${got} images used`;
  return `${head}${V.failed ? ` · ${V.failed} couldn't be fetched` : ''}${hid > 0 ? ` · ${hid} hidden by your flag filter` : ''} · ${s} season${s === 1 ? '' : 's'}`;
}
function step(d) { if (mode !== 'play') setMode('play'); P.pause(); const before = seasonOf(P.i); P.set(P.i + d, true); Snd.play(seasonOf(P.i) !== before ? 'season' : 'scrub'); }
// startViewTransition with its promises handled: a transition that is skipped or aborted (another
// one starts, the page is hidden) rejects ready/finished/updateCallbackDone, and the update still
// runs, so those rejections are expected and must not surface as "Uncaught (in promise)".
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
function viewTransition(update) {
  const t = document.startViewTransition(update);
  for (const p of [t?.ready, t?.finished, t?.updateCallbackDone]) p?.catch?.(() => {});
  return t;
}

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
    if (m !== 'blink') CB.leave();
    zoom = 1; layout(); onFrame(P.i); updatePlate();
  };
  if (withSound) Snd.play('tick');
  if (document.startViewTransition && !set.motion) viewTransition(apply); else apply();
}
document.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => setMode(b.dataset.mode, true); });
document.querySelectorAll('[data-fps]').forEach(b => { b.onclick = () => { P.fps = +b.dataset.fps; segSelect($('speedSeg'), x => x === b); Snd.play('tick'); }; });
$('play').onclick = () => { if (mode !== 'play') setMode('play'); P.toggle(); Snd.play('click'); };
$('holdKey').onclick = () => setHold(!HOLD.on);
// b8: the wavy line along the image's top edge gets a hover label (contam-ui.js draws it for airglow-flagged images)
$('cvA').addEventListener('pointermove', e => {
  const f = V.F[Math.min(P.i, V.F.length - 1)], cv = e.currentTarget;
  const top = mode === 'play' && f?.raw?.glow?.flagged && e.clientY - cv.getBoundingClientRect().top < Math.max(14, cssCell * 1.2);
  const t = top ? 'Wavy line: the archive marks this whole image for airglow (faint glow from Earth\'s upper atmosphere), so its background may be brighter. FLAGS ▾ explains each mark.' : '';
  if (cv.title !== t) cv.title = t;
});
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
  const f = F[b], rg = rangeOf(f.um), bl = bandLabel(rg); g.style.left = pos(f.mjd) + '%';
  g.firstChild.innerHTML = `${rg ? `<i style="--rc:${rg.c}"></i>` : ''}${R.fmtDate(f.date)}${f.um ? ` · λ ${f.um.toFixed(2)} µm` : ''}${bl ? ' · ' + esc(bl.text) : ''}`;
  g.title = bl ? bl.tip : '';
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
// b11 "Share this movie": the full link (target, scene, view mode, and the image when paused); no login needed
function shareURL() {
  const q = V.query, f = V.F[Math.min(P.i, V.F.length - 1)];
  const p = shareParams({ q: q?.type === 'name' ? q.name : null, ra: q?.type === 'coords' ? q.ra : null, dec: q?.type === 'coords' ? q.dec : null,
    scene, mode, mjd: !P.playing && f ? f.mjd : null });
  return `${location.origin}${location.pathname}?${p}`;
}
$('shareInsp').onclick = e => {
  const url = shareURL(), b = e.currentTarget, l = b.querySelector('.share-l');
  try { navigator.clipboard?.writeText(url)?.catch?.(() => {}); } catch { /* ignore */ }
  b.dataset.url = url; b.classList.add('done'); if (l) l.textContent = 'Link copied';
  toast('Link copied: opens without login'); Snd.play('confirm');
  setTimeout(() => { b.classList.remove('done'); if (l) l.textContent = 'Share this movie'; }, 1600);
};
function setCoordText(ra, dec) { $('coordTxt').textContent = `${R.fmtRA(ra)}  ${R.fmtDec(dec)}`; }

/* ---------- loading the time-lapse (real progress drives the rocket) ---------- */
function rocketAt(frac) {
  $('thinBar').style.transform = `scaleX(${frac})`; // the ScanLoader draws its own progress
}
/* loader v2 media + exit clip (DESIGN.md section 17; from design-v1.html) */
// Loader: Design Studio's code-based ScanLoader (design/loader/scan/), drawn from the real frames.
// 'astronaut' (Design Studio's video loop, v1.1; falls back to ScanLoader if the video can't play), 'scan' or 'sheet'
const LOADER = 'astronaut';
// Clean map -> time-lapse hand-over (DESIGN.md 35): the loader stays invisible while the images fill in
// behind the thin progress line. LOADER_DECIDE ms in, it fades in only if, at the rate so far, the images
// still to come would take LOADER_MIN_LEFT ms or more (or nothing has arrived yet). A 2 s load never flashes it.
const LOADER_DECIDE = 900, LOADER_MIN_LEFT = 2000;
function loaderNeeded(elapsed) {
  const done = V.FA.length + V.failed;
  if (!V.planned || !done) return true; // no plan or no image yet: no rate to judge by, so it is a slow load
  return (V.planned - done) * (elapsed / done) >= LOADER_MIN_LEFT;
}
let ldReveal = 0, ldLeaving = null;
function leaveLoader() {
  const L = $('stLoading'); if (L.hidden || !V.scan) return 0;
  const scan = V.scan; V.scan = null; clearTimeout(ldReveal);
  if (L.classList.contains('ld-wait')) { L.hidden = true; L.classList.remove('ld-wait'); scan.destroy(); return 0; } // never seen: no exit
  const ms = scan.done(); // AstroLoader returns its exit time; ScanLoader returns nothing
  const wait = set.motion ? 0 : (ms ?? 400);
  ldLeaving = { scan, t: setTimeout(() => { ldLeaving = null; L.hidden = true; scan.destroy(); }, wait) };
  return wait; // callers start playback after this, so the first images aren't hidden behind the exit clip
}
// showState(null) leaves #stLoading alone so leaveLoader() can fade it out
function showState(id) { ['stLoading', 'stError', 'stEmpty'].forEach(x => { if (id === null && x === 'stLoading') return; $(x).hidden = x !== id; }); if (id && id !== 'stLoading') { V.scan?.destroy(); V.scan = null; } }
let arriveCount = 0;
const STALL_MS = 10000;
function progress() {
  const done = V.F.length + V.failed, N = Math.max(1, V.planned);
  rocketAt(done / N);
  // Retries stay quiet (the thin line keeps moving); a message only when nothing has arrived for STALL_MS
  const slow = V.retries > 0 && V.status === 'loading' && performance.now() - V.lastArrive > STALL_MS;
  V.scan?.slow(slow ? `The image archive (IRSA) is slow right now. ${V.FA.length} of ${V.planned} images in; still asking for the rest.` : null);
  if (V.status === 'loading') $('d-meas').textContent = `measuring… (${V.FA.length} of ${V.planned || '…'} images)`;
  if (!V.F.length) setCounter(0); // "0 / 120 · 0 loaded" before the first image
  stallCheck();
  updatePlate();
}
/* Live-load watchdog (judging panel a10): no new image for 20 s, or IRSA keeps answering "busy"
   (8 retries in a row with no image between), and the stage says so, with Retry and
   "Use the N images loaded". AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026. */
const STALL_HARD_MS = 18000, STALL_RETRIES = 8; // 18 s + the 1 s check: the message is up within 20 s
let stallTimer = 0;
function stallCheck() {
  if (V.status !== 'loading' || V.stalled) return;
  const quiet = performance.now() - V.lastArrive, busy = V.retries - (V.retriesAtArrive || 0);
  if (quiet < STALL_HARD_MS && busy < STALL_RETRIES) return;
  V.stalled = true; $('thin').hidden = true; leaveLoader(); updatePlate();
  const n = V.FA.length;
  const why = busy >= STALL_RETRIES ? `It answered "busy" ${busy} times in a row` : n ? `No new image for ${Math.round(quiet / 1000)} s` : `Nothing arrived in ${Math.round(quiet / 1000)} s`;
  $('errTxt').textContent = n ? `${why}. ${n} of ${V.planned} images arrived; you can use them, or ask again.` : `${why}. Retry asks again.`;
  $('retry').hidden = false; $('useLoaded').hidden = !n; $('useLoaded').textContent = `Use the ${n} image${n === 1 ? '' : 's'} loaded`;
  showState('stError'); Snd.play('error');
}
// A coordinate patch's heading (capitalised); the loader's "Finding images of …" keeps it lower case.
let holdMjd = null; // ?mjd= from the URL: the image to stop on once loading finishes
let wantView = null; // ?view= from the URL (a shared link): the mode to open once loading finishes
const PATCH_NAME = 'This patch', loaderName = n => (n === PATCH_NAME ? 'this patch' : n);
function load(query, label) {
  V.ctl?.abort(); const ctl = V.ctl = new AbortController();
  P.pause(); clearInterval(bt); if (mode !== 'play') { mode = 'play'; $('stage').className = 'stage mode-play'; segSelect($('viewSeg'), b => b.dataset.mode === 'play'); }
  TS.show(false); TS.reset();
  CB.leave(); LC.data(null, null, label, true);
  CX.reset();
  Object.assign(V, { query, target: null, ring: null, grid: null, raws: [], F: [], FA: [], FK: [], stacks: [], planned: 0, plannedMjds: [], failed: 0, retries: 0, retriesAtArrive: 0, stalled: false, finish: null, lastArrive: performance.now(), status: 'loading', motion: null, seasons: [], name: label || PATCH_NAME });
  P.i = 0; shown = -1; arriveCount = 0;
  holdForLoad(); holdKey(); plateKey = '';
  clearInterval(stallTimer); stallTimer = setInterval(() => { if (ctl.signal.aborted || V.status !== 'loading') clearInterval(stallTimer); else stallCheck(); }, 1000);
  $('stLoading').classList.remove('leaving');
  // a loader still fading out from the last load shares #scanLoader: finish it now, or its late
  // destroy() would wipe (and hide) the new one
  if (ldLeaving) { clearTimeout(ldLeaving.t); ldLeaving.scan.destroy(); ldLeaving = null; }
  V.scan?.destroy();
  { const L = $('stLoading'), t0 = performance.now(); L.classList.add('ld-wait'); clearTimeout(ldReveal);
    ldReveal = setTimeout(() => { if (!ctl.signal.aborted && V.status === 'loading' && loaderNeeded(performance.now() - t0)) L.classList.remove('ld-wait'); }, LOADER_DECIDE); }
  // Reduce motion -> the scan loader (DESIGN.md 17b); otherwise the astronaut video (it falls back to ScanLoader itself)
  V.scan = (LOADER === 'astronaut' && !set.motion && window.AstroLoader ? window.AstroLoader : window.ScanLoader)($('scanLoader'), {
    mode: LOADER, base: '/loader/v1.1/', target: loaderName(V.name), bands: ranges.map(r => ({ ...r, name: bandName(r) })), // caption says "CO₂-ice band", a range
    reducedMotion: set.motion,
    onStart: () => { Snd.play('click'); $('thin').hidden = false; const w = leaveLoader(); if (!set.motion && !Number.isFinite(holdMjd)) setTimeout(() => P.play(), w); },
    onRetry: () => { Snd.play('click'); if (V.query) load(V.query, V.name); },
  });
  showState('stLoading'); $('thin').hidden = false; buildTimeline(); progress(); draw(); onFrame(0); // thin line from the start: the loader may never show
  const emit = (e) => {
    if (ctl.signal.aborted) return;
    if (e.type === 'RESOLVED') { V.target = e.target; GH.forTarget(e.target); V.name = label || e.target.name || PATCH_NAME; V.scan?.set({ target: loaderName(V.name) }); }
    else if (e.type === 'PLANNED') {
      V.grid = e.plan.grid; V.n = V.grid.n; V.planned = e.plan.planned; V.plannedMjds = e.plan.mjds || [];
      V.total = e.plan.total;
      { const m = V.plannedMjds; V.ring = ringObject(V.target, V.grid, m.length ? (m[0] + m[m.length - 1]) / 2 : 61000, PRESETS); ringPanel(); }
      V.scan?.set({ total: V.planned, plan: V.plannedMjds.map(mjd => ({ mjd })) });
      if (!V.planned) { V.status = 'empty'; showState('stEmpty'); return; }
      $('tName').textContent = V.name; $('ra').textContent = R.fmtRA(V.grid.ra0); $('dec').textContent = R.fmtDec(V.grid.dec0); setCoordText(V.grid.ra0, V.grid.dec0);
      $('d-field').textContent = `${Math.round(V.n * V.grid.scale)}″ · north up`;
      renderLook();
      layout(); buildTimeline(); progress();
    } else if (e.type === 'FRAME') {
      const f = toF(e.frame); V.raws.push(e.frame); V.lastArrive = performance.now(); V.retriesAtArrive = V.retries;
      if (V.stalled) { V.stalled = false; $('stError').hidden = true; $('thin').hidden = false; } // the archive answers again
      let k = V.FA.findIndex(x => x.mjd > f.mjd); if (k < 0) k = V.FA.length; V.FA.splice(k, 0, f);
      V.scan?.add(f);
      const keep = V.F[P.i]; V.FK = CX.filter(V.FA); V.F = shownFrames(); if (keep) P.i = Math.max(0, V.F.indexOf(keep));
      CX.ensureLayers();
      progress(); rebuildSoon();
    } else if (e.type === 'FRAME_FAILED') { V.failed++; progress(); }
    else if (e.type === 'RETRY_WAIT') { V.retries++; progress(); setTimeout(() => { if (!ctl.signal.aborted) progress(); }, STALL_MS + 100); }
    else if (e.type === 'DONE') finish();
    else if (e.type === 'ERROR' || e.type === 'NOT_FOUND') {
      V.status = 'error'; $('thin').hidden = true;
      $('errTxt').textContent = e.message + (V.FA.length ? ` ${V.FA.length} images arrived and are kept.` : '');
      $('retry').hidden = e.type === 'NOT_FOUND'; $('useLoaded').hidden = !V.FA.length; $('useLoaded').textContent = `Use the ${V.FA.length} image${V.FA.length === 1 ? '' : 's'} loaded`;
      showState('stError'); Snd.play('error');
    }
  };
  // Loading done, or the visitor chose "Use the N images loaded" (then the run is aborted first)
  const finish = V.finish = () => {
    {
      clearInterval(stallTimer); V.stalled = false;
      V.status = 'ready'; $('thin').hidden = true; const leaveWait = leaveLoader();
      if (!V.FA.length) { V.status = 'error'; $('errTxt').textContent = 'No images arrived. The archive is often busy; Retry asks again.'; $('useLoaded').hidden = true; showState('stError'); Snd.play('error'); return; }
      showState(null);
      restack(); // seasons stacked from the images the flag filter keeps
      remeasure();
      buildTimeline(); findOther(); // buildTimeline sets V.seasons for the count below
      $('d-n').textContent = countText();
      // ?mjd= (Archive/Spectrum "Play" links): show the image nearest that date and stay paused there
      const held = Number.isFinite(holdMjd) && V.F.length > 0;
      if (held) { const m = holdMjd; holdMjd = null; let b = 0; V.F.forEach((f, k) => { if (Math.abs(f.mjd - m) < Math.abs(V.F[b].mjd - m)) b = k; }); P.pause(); P.set(b, true); }
      onFrame(P.i); Snd.play('confirm');
      // V.FA = every image loaded; V.F = the ones the user's flag filter keeps (QA, Sun: say so, so the counts match Proof)
      // Master item 1: say that up to 120 images are used, spread evenly in time, out of all IRSA found
      const hid = V.FA.length - V.FK.length, hidTxt = hid > 0 ? ` ${hid} hidden by your flag filter (FLAGS ▾ to change).` : '';
      const usedTxt = V.planned < V.total ? `${V.FA.length} of the ${V.total} images IRSA has here are in (spread evenly over time to keep it quick).` : V.failed ? `${V.FA.length} of ${V.total} images are in.` : `All ${V.FA.length} images are in.`;
      toast(`${usedTxt}${hidTxt}${V.failed ? ` ${V.failed} couldn't be fetched (IRSA busy); Retry later fills them.` : ''}`);
      // b2: a preset opens on the Blink of its first and last season stacks (the hop, with the ring and the caption);
      // ?view= (a shared link) opens its own mode; anything else plays
      const want = wantView; wantView = null;
      setTimeout(() => {
        if (V.ctl !== ctl) return;
        if (want && want !== 'play') { setMode(want); return; }
        if (!want && holdPreset() && !held && V.stacks.length > 1) { P.pause(); setMode('blink'); return; }
        if (!set.motion && !P.playing && !held) P.play();
      }, leaveWait);
    }
  };
  tablesReady.then(() => { if (!ctl.signal.aborted) run(query, SETTINGS, { base: BASE, signal: ctl.signal, tables, emit }); });
}
$('retry').onclick = () => { Snd.play('click'); if (V.query) load(V.query, V.name); };
$('useLoaded').onclick = () => { Snd.play('click'); if (V.finish && V.FA.length && V.status !== 'ready') { V.ctl?.abort(); V.finish(); } else showState(null); };

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
      tag.innerHTML = snap ? esc(snap[2].name) : p ? `<span class="x-only">${R.fmtRA(p[0])}  ${R.fmtDec(p[1])}</span><span class="s-only">${esc(lookShort(p[0], p[1]))}</span>` : '';
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
// RA/Dec is Expert; Simple gets the plain "where to look" twin (Master items 3 and 5)
// b8: the dock cell says "Cursor" while the pointer is on the map, "This spot" (the map centre) otherwise
function readout(ra, dec, atCursor) { const t = `<span class="x-only">${R.fmtRA(ra)}  ${R.fmtDec(dec)}</span><span class="s-only">${esc(lookShort(ra, dec))}</span>`; $('mdCursor').innerHTML = t;
  const lbl = $('mdCursor').previousElementSibling; if (lbl) { lbl.textContent = atCursor ? 'Cursor' : 'This spot'; lbl.title = atCursor ? 'The sky under your pointer' : 'The centre of the map (move the pointer over the map to read any point)'; } $('mapRead').innerHTML = `<span class="x-only">FOV ${fovTxt()}</span><span class="sep x-only">·</span><span class="s-only">This spot:</span><span>${t}</span>`; }
$('mapWrap').addEventListener('pointermove', e => { pointer = { x: e.clientX, y: e.clientY }; if (!skymap.aladin) return; const r = $('mapWrap').getBoundingClientRect(), w = skymap.toWorld(e.clientX - r.left, e.clientY - r.top); if (w) readout(w[0], w[1], true); });
$('mapWrap').addEventListener('pointerleave', () => { if (skymap.aladin) { const c = skymap.center(); readout(c.ra, c.dec); } });
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
  $('mdSel').innerHTML = t ? esc(t.name) : `<span class="x-only">${ra.toFixed(3)}°, ${dec >= 0 ? '+' : ''}${dec.toFixed(3)}°</span><span class="s-only">A patch you picked</span>`;
  updateURL();
  if (fromUser) { Snd.play('tick'); if (innerWidth < 1100) { sheet(true); if (innerWidth < 700) skymap.panBy(0, -0.24); } }
}

/* search / quick picks: fly the map there and select */
// Old Archive/Spectrum links (and typed coordinates) give ra/dec. Within PRESET_SNAP_ARCSEC of a
// quick-pick star, at its catalogue (J2000) position or anywhere along its track up to a year after
// now, they open as that star: name, ring, catalogue motion and pre-saved images.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
const PRESET_SNAP_ARCSEC = 10;
function presetNear(ra, dec) {
  let best = null, bestSep = Infinity;
  for (const t of TARGETS) for (let k = 0; k <= 80; k++) { // Barnard's Star: 80 steps of ~4.6″ along 27 years
    const p = propagate(t.preset.target, 51544.5 + (NOW_MJD + 365 - 51544.5) * k / 80), sep = separationArcsec(ra, dec, p.ra, p.dec);
    if (sep < bestSep) { bestSep = sep; best = t; }
  }
  return bestSep <= PRESET_SNAP_ARCSEC ? best : null;
}
async function goTo(text) {
  $('serr').hidden = true; // a pick, a Try key or a new search clears an earlier error
  let q;
  try { q = parseQuery(text); } catch (err) { if (err instanceof QueryError) { showSearchError(text, err.message); Snd.play('error'); return; } throw err; }
  if (scene !== 'map') toMap(true);
  if (q.type === 'coords') {
    const pt = presetNear(q.ra, q.dec); // a ra/dec on (or within 10″ of) a quick-pick star opens as that star
    if (pt) return flyTo(pt.ra, pt.dec, 2, () => select(pt.ra, pt.dec, pt, false));
    return flyTo(q.ra, q.dec, Math.min(skymap.aladin ? skymap.fov() : 1, 1), () => select(q.ra, q.dec, null, false));
  }
  const preset = findPreset(q.name);
  if (preset) { const t = TARGETS.find(x => x.key === preset.key); return flyTo(t.ra, t.dec, 2, () => select(t.ra, t.dec, t, false)); return; }
  $('serr').hidden = true; toast(`Looking up “${q.name}” in SIMBAD…`);
  try {
    const tg = await resolveTarget(q);
    const now = (tg.pmra || tg.pmdec) ? propagate(tg, NOW_MJD) : tg;
    const t = { key: 'q', name: shownName(q.name, tg.name), id: plainType(tg.otype), ra: now.ra, dec: now.dec, simbad: tg };
    await flyTo(t.ra, t.dec, 2, () => select(t.ra, t.dec, t, false));
  } catch (err) { showSearchError(q.name, /recursive|wasm|unreachable|aliasing/i.test(err.message) ? '' : err.message); Snd.play('error'); }
}
// The name to show for a SIMBAD hit: what the person typed ("Vega"), not SIMBAD's main id ("alf Lyr").
// Typed codes with digits ("hd 172167") keep SIMBAD's spelling; all-lowercase words get capitals.
function shownName(typed, simbadName) {
  const s = String(typed).trim().replace(/\s+/g, ' ');
  if (!s || s.toLowerCase() === String(simbadName).toLowerCase()) return simbadName || s;
  if (s !== s.toLowerCase()) return s;
  if (/\d/.test(s)) return simbadName || s;
  return s.replace(/(^|[\s-])(\p{L})/gu, (m, a, c) => a + c.toUpperCase());
}
// SIMBAD object types in plain words; codes the map's table lacks (newer SIMBAD codes) fall back to words, never a raw code.
const OTYPE_MORE = { 'dS*': 'Delta Scuti variable', 'Ma*': 'Massive star', 'Be*': 'Be star', 'LP*': 'Long-period variable', 'El*': 'Ellipsoidal variable',
  'Er*': 'Eruptive variable', 'HS*': 'Hot subdwarf', 'OH*': 'OH/IR star', 'pA*': 'Post-AGB star', 'RS*': 'RS CVn variable', 'S*': 'S-type star',
  'SX*': 'SX Phoenicis variable', 'WR*': 'Wolf-Rayet star', 'Pe*': 'Chemically peculiar star', 'HV*': 'High-velocity star', 'Ae*': 'Herbig Ae/Be star',
  'bC*': 'Beta Cephei variable', 'Ir*': 'Irregular variable', 'No*': 'Nova', 'CV*': 'Cataclysmic variable', 'BS*': 'Blue straggler', 'SG*': 'Supergiant',
  'RB*': 'Red giant branch star', 'YSO': 'Young stellar object', 'bL*': 'Beta Lyrae binary', 'Al*': 'Algol-type binary', 'WV*': 'Type II Cepheid',
  'cC*': 'Classical Cepheid', 'Psr': 'Pulsar', 'Pl': 'Planet', 'Neb': 'Nebula', 'SNR': 'Supernova remnant', 'Cl*': 'Star cluster', 'As*': 'Group of stars' };
function plainType(code) {
  if (!code) return 'SIMBAD object';
  const w = otypeName(code);
  if (w !== code) return w;
  return OTYPE_MORE[code] || (/\*$/.test(code) ? 'Star' : 'Sky object');
}
function showSearchError(text, why) {
  const near = TARGETS.find(x => { const a = x.name.toLowerCase().replace(/[^a-z]/g, ''), b = String(text).toLowerCase().replace(/[^a-z]/g, ''); return b.length > 3 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))); });
  const el = $('serr'); el.hidden = false; $('toast').classList.remove('show'); // the "Looking up..." toast is answered
  el.innerHTML = `<span>${why ? esc(why) : `Couldn't find “${esc(text)}”.`}</span>${near ? `<button class="key" id="serrFix">Try ${esc(near.name)}</button>` : ''}${why && /coordinates|RA Dec|269\.45/i.test(why) ? '' : '<span style="color:var(--muted)">or type RA Dec like 269.45 +4.69</span>'}`; // one hint only (a11)
  if (near) $('serrFix').onclick = () => { el.hidden = true; $('q').value = near.name; goTo(near.name); };
}
$('q').addEventListener('input', () => { $('serr').hidden = true; });
function doSearch() { $('serr').hidden = true; Snd.play('click'); goTo($('q').value); }
document.querySelector('form.search').onsubmit = (e) => { e.preventDefault(); doSearch(); };
// Quick picks that don't all fit: fade the side that has more (live.css .more-l / .more-r), let a
// mouse wheel scroll them sideways, and bring a focused pick into view.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
{
  const pk = document.querySelector('.topbar .picks');
  if (pk) {
    const edges = () => { const max = pk.scrollWidth - pk.clientWidth; pk.classList.toggle('more-l', pk.scrollLeft > 2); pk.classList.toggle('more-r', max - pk.scrollLeft > 2); };
    pk.addEventListener('scroll', edges, { passive: true });
    pk.addEventListener('wheel', e => { if (pk.scrollWidth > pk.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { pk.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    pk.addEventListener('focusin', e => e.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }));
    new ResizeObserver(edges).observe(pk); edges();
  }
}
document.querySelectorAll('.pick').forEach(b => { b.onclick = () => { Snd.play('click'); document.querySelectorAll('.pick').forEach(x => x.setAttribute('aria-pressed', x === b)); $('q').value = b.textContent; goTo(b.textContent); }; });

/* ---------- coordinate details panel ---------- */
const CP = '<svg class="cp" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.5A1 1 0 0 1 4 2.5h6.5"/></svg><svg class="ok" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
const TAGS = { obs: ['t-obs', 'Observed'], calc: ['t-calc', 'Computed'], cat: ['t-cat', 'Catalogue'] };
// nb (optional): the notebook entry for this row ({ label, value, unit, uncertainty, source, tag });
// the row then gets one "+" key, which saves it with the context of the moment it is pressed.
const NB_ROWS = new Map();
// cls: 'x-only' (Expert) or 's-only' (Simple twin), see expert.js
const row = (label, value, tag, nb, cls) => { if (nb) NB_ROWS.set(label, nb);
  return `<div class="cd-row${nb ? ' has-nb' : ''}${cls ? ' ' + cls : ''}"><span class="cd-l">${label}</span><span class="cd-t"><span class="t-mini ${TAGS[tag][0]}">${TAGS[tag][1]}</span></span><span class="cd-v">${value}</span><button class="key cd-c" aria-label="Copy ${label}">${CP}</button>${nb ? `<button type="button" class="nb-plus" data-nb="row:${esc(label)}" aria-label="Add ${esc(label)} to the lab notebook" title="Add to the lab notebook">+</button>` : ''}</div>`; };
const sgn = v => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(4) + '°';
let cdCtl = null, repaintMot = null;
function catalogueOf(t) { return t?.preset?.target || t?.simbad || null; }

/* ---------- Motion panel (DESIGN.md 27): one row per quantity, unit, source tag ---------- */
const nf = (v, d) => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fx = (v, d) => (v < 0 ? '−' : '') + nf(v, d);
const fsg = (v, d) => (v < 0 ? '−' : '+') + nf(v, d);
const pm = (e, d = 2) => (Number.isFinite(e) && e > 0 ? ` ± ${nf(e, Math.min(4, Math.max(d, -Math.floor(Math.log10(e)))))}` : '');
// Simple-mode words for a sky motion: "10 arcseconds", "1.4 arcseconds", "0.05 arcseconds"
const plainArcsec = v => { const a = Math.abs(v), n = a >= 10 ? Math.round(a) : a >= 1 ? +a.toFixed(1) : a >= 0.01 ? +a.toPrecision(1) : null;
  return n == null ? 'less than 0.01 arcseconds' : `${n} arcsecond${n === 1 ? '' : 's'}`; };
const fYears = y =>y < 10 ? y.toPrecision(2) : Math.round(y).toLocaleString('en-US');
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
  // notebook entries for the "+" keys: the shown value rounded as shown, its unit, error and source tag
  const unc = e => (Number.isFinite(e) && e > 0 ? +e.toPrecision(2) : '');
  const ent = (label, value, unit, uncertainty, source, tag) => ({ label, value, unit, uncertainty, source, tag });
  const name = t?.name ? `${t.name}: ` : '';
  if (!k || k.mu == null) {
    h += looking ? '<p class="quiet">Looking up the motion in Gaia DR3…</p>' : '<p class="quiet">No catalogued motion for this object.</p>';
  } else {
    h += motionDial(k.pa) +
      row('Proper motion, total and direction', `${nf(k.mu, 1)}${pm(k.muErr)} mas/yr · ${k.pa.toFixed(1)}°`, 'cat',
        ent(`${name}proper motion (catalogue), direction ${k.pa.toFixed(1)}° east of north`, +k.mu.toFixed(1), 'mas/yr', unc(k.muErr), srcName(pmFrom), 'CATALOGUE'), 'x-only') +
      row('How fast it moves across the sky', `about ${plainArcsec(k.arcsecYr)} a year, towards the ${dirWord(k.pa)}`, 'cat', null, 's-only') +
      row('Proper motion, east · north', `${fsg(pmFrom.pmra, 1)}${pm(pmFrom.pmraErr)} · ${fsg(pmFrom.pmdec, 1)}${pm(pmFrom.pmdecErr)} mas/yr`, 'cat', null, 'x-only') +
      row('Angular speed across the sky', `${k.arcsecYr.toFixed(k.arcsecYr < 0.1 ? 4 : 2)}″/yr · 1 pixel every ${fYears(k.yrPerPix)} years`, 'calc', null, 'x-only') +
      row('Shift in SPHEREx images', `one image pixel every ${fYears(k.yrPerPix)} years`, 'calc', null, 's-only');
    if (k.dist) {
      h += row('Parallax', `${nf(plxFrom.plx, 3)}${pm(plxFrom.plxErr, 3)} mas`, 'cat', null, 'x-only') +
        row('Distance (1000 / parallax)', `${k.dist.pc < 100 ? k.dist.pc.toFixed(3) : nf(k.dist.pc, 0)} pc · ${k.dist.ly < 100 ? k.dist.ly.toFixed(2) : nf(k.dist.ly, 0)} ly`, 'calc',
          ent(`${name}distance (1000 / parallax)${k.dist.weak ? ', unreliable: parallax under 5× its error' : ''}`, +k.dist.pc.toFixed(k.dist.pc < 100 ? 3 : 0), 'pc', '', `Worked out from the ${srcName(plxFrom)} parallax`, 'COMPUTED'), 'x-only') +
        row('Distance', `about ${k.dist.ly < 10 ? k.dist.ly.toFixed(1) : nf(Math.round(k.dist.ly), 0)} light years`, 'calc', null, 's-only');
      if (k.dist.weak) h += `<p class="quiet err">Parallax is only ${k.dist.snr.toFixed(1)}× its error (under 5×), so this distance and the speeds below are unreliable.</p>`;
    }
    if (k.vt != null) h += row('Speed across the sky', `${k.vt.toFixed(1)}${pm(k.vtErr, 1)} km/s`, 'calc',
      ent(`${name}speed across the sky (4.74 × proper motion / parallax)`, +k.vt.toFixed(1), 'km/s', unc(k.vtErr), 'Worked out from catalogue values', 'COMPUTED'), 'x-only') +
      row('Speed across the sky', `about ${Math.round(k.vt)} km each second`, 'calc', null, 's-only');
    if (k.vr != null) h += row('Radial velocity', `${fsg(k.vr, 1)}${pm(rvFrom === gaia ? gaia.rvErr : null, 1)} km/s · ${k.vr < 0 ? 'towards us' : 'away from us'}`, 'cat',
      ent(`${name}radial velocity (${k.vr < 0 ? 'towards us' : 'away from us'})`, +k.vr.toFixed(1), 'km/s', unc(rvFrom === gaia ? gaia.rvErr : null), srcName(rvFrom), 'CATALOGUE'), 'x-only') +
      row('Speed towards or away from us', `about ${Math.round(Math.abs(k.vr))} km each second ${k.vr < 0 ? 'towards us' : 'away from us'}`, 'cat', null, 's-only');
    if (k.vtot != null) h += row('Speed through space', `${k.vtot.toFixed(1)} km/s`, 'calc',
      ent(`${name}speed through space`, +k.vtot.toFixed(1), 'km/s', '', 'Worked out from catalogue values', 'COMPUTED'), 'x-only') +
      row('Speed through space', `about ${Math.round(k.vtot)} km each second`, 'calc', null, 's-only');
    if (k.uvw) { // Design §27 follow-up: these two rows live in the closed "More detail" disclosure
      const L = toLSR(k.uvw);
      more += row('Galactic U, V, W (relative to the Sun)', `${fx(k.uvw.U, 1)}, ${fx(k.uvw.V, 1)}, ${fx(k.uvw.W, 1)} km/s`, 'calc') +
        row('Galactic U, V, W (local standard of rest)', `${fx(L.U, 1)}, ${fx(L.V, 1)}, ${fx(L.W, 1)} km/s`, 'calc');
    }
  }
  // measured in these images (OBSERVED), once the patch has been played and the fit is final
  if (same && V.motion?.ok && firstS() && lastS() && V.stacks.length > 1) {
    // data.js significance rule (also on the Proof page): under 3σ -> "no significant motion (< upper limit)"
    // data.js measurability rule (also on the Proof page): saturated core / under a pixel -> "Not measurable here"
    const mc = motionCheck(), meas = !mc || mc.measurable;
    const m = V.motion.total / 1000, me = V.motion.totalErr / 1000, sig = V.motion.significant !== false;
    const dets = V.motion.detectors, detTxt = dets ? ` (detectors ${detectorText(dets)}, where ${esc(V.name)} shows)` : '';
    const used = usedText(V.motion, false) + detTxt, useAll = filterHides(V.motion) ? `<p class="quiet">${USE_ALL}</p>` : '';
    if (meas) {
      const val = sig ? `${m.toFixed(2)} ± ${me.toFixed(2)}″/yr` : `no significant motion (&lt; ${(V.motion.upperLimit / 1000).toFixed(2)}″/yr)`;
      // Simple twin: the same verdict in words ("about 10 arcseconds a year"; "no significant motion" stays word for word)
      h += row('Measured in these images (SPHEREx)', `${val} · ${used}`, 'obs', nbMeasured(), sig ? 'x-only' : '') +
        (sig ? row('Measured in these images (SPHEREx)', `moves about ${plainArcsec(m)} a year · ${used}`, 'obs', null, 's-only') : '') + useAll;
      if (k?.mu != null) h += `<p class="mot-cmp num x-only">Catalogue ${k.arcsecYr.toFixed(2)}″/yr · measured here ${sig ? `${m.toFixed(1)} ± ${me.toFixed(1)}″/yr` : val}</p>` +
        `<p class="mot-cmp s-only">Star catalogue: about ${plainArcsec(k.arcsecYr)} a year · measured here: ${sig ? `about ${plainArcsec(m)} a year` : val}</p>`;
    } else {
      const nm = notMeasurableText(mc, V.motion);
      h += row('Measured in these images (SPHEREx)', nm.head, 'obs', nbMeasured());
      if (nm.note) h += `<p class="quiet">${nm.note}</p>`;
      h += useAll;
      if (k?.mu != null) h += `<p class="mot-cmp num x-only">Catalogue ${k.arcsecYr.toFixed(2)}″/yr · not measurable here</p><p class="mot-cmp s-only">Star catalogue: about ${plainArcsec(k.arcsecYr)} a year · not measurable here</p>`;
    }
    // a speed from the measured motion only when that motion is measurable and significant
    const vtm = sig && meas ? tangentialVelocity(V.motion.total, plxFrom?.plx) : null;
    if (vtm) h += row('Speed across the sky, from the measured motion', `${vtm.toFixed(0)} km/s`, 'calc',
      ent(`${name}speed across the sky, from the motion measured in SPHEREx images`, +vtm.toFixed(0), 'km/s', '', `Measured motion with the ${srcName(plxFrom)} parallax`, 'COMPUTED'));
  } else if (!same && k?.mu != null) h += '<p class="quiet">Play this patch to measure the motion from the SPHEREx images.</p>';
  if (k?.mu != null) {
    const parts = [`motion: ${srcName(pmFrom)}${gaia ? ` ${esc(gaia.source.replace('Gaia DR3 ', ''))}` : ''}`];
    if (plxFrom) parts.push(`parallax: ${srcName(plxFrom)}`);
    if (rvFrom) parts.push(`radial velocity: ${srcName(rvFrom)}`);
    h += `<p class="quiet mot-src">Catalogue values · ${parts.join(' · ')}${gaia && !cat ? ' (brightest Gaia star within 8″ of this point, epoch 2016)' : ''}.</p>` +
      `<details class="mot-how x-only"><summary>More detail</summary>${more}<p class="mot-how-h">How these are worked out</p><ul>
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
  // RA/Dec (sexagesimal + degrees), galactic and ecliptic are Expert; Simple keeps the constellation and the "where to look" line
  $('cdPos').innerHTML = row('RA', `${R.fmtRA(s.ra)} · ${s.ra.toFixed(5)}°`, t ? 'cat' : 'calc', null, 'x-only') + row('Dec', `${R.fmtDec(s.dec)} · ${sgn(s.dec)}`, t ? 'cat' : 'calc', null, 'x-only') +
    row('Galactic l, b', `${g.l.toFixed(4)}°, ${sgn(g.b)}`, 'calc', null, 'x-only') + row('Ecliptic λ, β', `${e.lon.toFixed(4)}°, ${sgn(e.lat)}`, 'calc', null, 'x-only') +
    (con ? row('Constellation', esc(con.name), 'calc') : '') +
    '<p class="quiet s-only">Sky coordinates (RA, Dec) are in Expert mode.</p>' +
    (t && cat && (cat.pmra || cat.pmdec) ? '<p class="quiet">Position shown for Nov 2026 (catalogue position moved along its proper motion).</p>' : '');
  // coverage: asked live from IRSA
  $('cdCov').innerHTML = '<p class="quiet">Asking IRSA what SPHEREx has here…</p>';
  const to = AbortSignal.timeout(20000);
  listImages(s.ra, s.dec, { base: BASE, signal: AbortSignal.any([ctl.signal, to]) }).then(imgs => {
    if (ctl.signal.aborted) return;
    if (!imgs.length) { $('cdCov').innerHTML = '<p class="quiet">No SPHEREx images cover this point in the released data yet.</p>'; return; }
    const d = (m) => mjdToDate(m).toISOString().slice(0, 10), dets = [...new Set(imgs.map(i => i.detector))].sort();
    const wl = `${Math.min(...imgs.map(i => i.bandMinUm || 9)).toFixed(2)}–${Math.max(...imgs.map(i => i.bandMaxUm || 0)).toFixed(2)} µm`;
    const mon = m => { const x = mjdToDate(m); return `${MON[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };
    $('cdCov').innerHTML = row('SPHEREx images', `${imgs.length.toLocaleString()} images`, 'obs') + row('Date span', `${d(imgs[0].mjdStart)} → ${d(imgs[imgs.length - 1].mjdStart)}`, 'obs', null, 'x-only') +
      row('Dates', `${mon(imgs[0].mjdStart)} to ${mon(imgs[imgs.length - 1].mjdStart)}`, 'obs', null, 's-only') +
      row('Detectors', dets.map(x => 'D' + x).join(', ') + ` · ${wl}`, 'obs', null, 'x-only') + row('Infrared colours', `${wl} (light too red for the eye)`, 'obs', null, 's-only');
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

/* ---------- Lab notebook "+" keys (web/app/notebook, docs/codex-notebook.md) ----------
   One "+" per key value in the info panel. Each saves the value as shown, with its unit, error,
   source and source tag, plus where and when it was seen (target position, image date, view URL). */
window.openNotebook = openNotebook; // also the hook the guided tour looks for (tour/steps.js)
// notebook position: Expert adds decimal degrees; Simple names the constellation instead (QA item 9)
const posText = (ra, dec) => { if (isExpert()) return `${R.fmtRA(ra)} ${R.fmtDec(dec)} (${ra.toFixed(5)}°, ${sgn(dec)})`;
  const c = constellation(ra, dec); return `${c ? `In ${c.name} · ` : ''}${R.fmtRA(ra)} ${R.fmtDec(dec)}`; };
function nbMeasured() {
  const mo = V.motion; if (!mo?.ok) return null;
  const sig = mo.significant !== false, used = usedText(mo);
  const base = { unit: '″/yr', source: 'SPHEREx images via IRSA, motion fitted in Star Shift', tag: 'OBSERVED' };
  const mc = motionCheck();
  if (mc && !mc.measurable) return { ...base, unit: '', uncertainty: '', value: 'not measurable',
    label: `${V.name}: motion not measurable in these SPHEREx images (${mc.saturated ? 'centre saturated' : mc.slow ? 'catalogue motion under one pixel over these dates' : 'no fit'}; ${used})` };
  return sig ? { ...base, label: `${V.name}: proper motion measured in these SPHEREx images (${used})`, value: +(mo.total / 1000).toFixed(2), uncertainty: +(mo.totalErr / 1000).toFixed(2) }
    : { ...base, label: `${V.name}: no significant motion in these SPHEREx images (${used}); upper limit`, value: `< ${(mo.upperLimit / 1000).toFixed(2)}`, uncertainty: '' };
}
const NB_VIEW = {
  pos() {
    if (scene === 'viewer' && V.grid) { const named = V.query?.type === 'name';
      return { label: `${V.name}: centre of this time-lapse (RA, Dec)`, value: posText(V.grid.ra0, V.grid.dec0), unit: '', uncertainty: '',
        source: named ? 'SIMBAD position used for this time-lapse' : 'The position you asked for', tag: named ? 'CATALOGUE' : 'COMPUTED' }; }
    const s = M.sel; if (!s) return null; const t = s.t, cat = catalogueOf(t), moved = !!(t && cat && (cat.pmra || cat.pmdec));
    return { label: t ? `${t.name}: position (RA, Dec)${moved ? ', moved to Nov 2026 along its catalogue motion' : ''}` : 'Selected position (RA, Dec)',
      value: posText(s.ra, s.dec), unit: '', uncertainty: '', source: t ? (t.preset ? 'SIMBAD (built-in)' : 'SIMBAD') : 'Picked on the sky map', tag: t ? 'CATALOGUE' : 'COMPUTED' };
  },
  meas: nbMeasured,
  date() { const f = nbInfo; if (!f) return null; const st = f.det === 'stack';
    return { label: `${V.name}: ${st ? 'dates of this season stack' : 'date of this image'}`, value: st ? sRange(f) : `${f.date.slice(0, 10)} ${f.date.slice(11, 16)} UTC`, unit: '', uncertainty: '',
      source: 'SPHEREx image header via IRSA', tag: 'OBSERVED' }; },
  um() { const f = nbInfo; if (!f) return null;
    return { label: `${V.name}: wavelength of this image`, value: f.um ? +f.um.toFixed(2) : 'mixed (season stack)', unit: f.um ? 'µm' : '', uncertainty: '',
      source: f.um ? `SPHEREx detector D${f.det} via IRSA` : 'SPHEREx images via IRSA', tag: 'OBSERVED' }; },
  band() { const f = nbInfo, bl = f && bandLabel(rangeOf(f.um)); if (!bl) return null;
    return { label: `${V.name}: colour band of this image (a wavelength range, not a detection)`, value: bl.text, unit: '', uncertainty: '',
      source: `Your colour bands, from the measured λ ${f.um.toFixed(2)} µm`, tag: 'COMPUTED' }; },
  mask() { const f = nbInfo; if (!f) return null; const fl = CX.flaggedText(f), n = V.n * V.n;
    return { label: `${V.name}: ${fl ? 'flagged pixels' : 'no-data pixels'} in this ${f.det === 'stack' ? 'season stack' : 'image'}`,
      value: fl ? parseInt(fl.text, 10) : f.d.filter(v => v == null).length, unit: `pixels of ${n}`, uncertainty: '',
      source: fl ? `SPHEREx quality mask via IRSA (${fl.title})` : 'SPHEREx images via IRSA', tag: 'OBSERVED' }; },
};
function nbContext() {
  const f = scene === 'viewer' ? nbInfo : null, p = curPos();
  return { page: 'Viewer', ra: p ? +p.ra.toFixed(5) : '', dec: p ? +p.dec.toFixed(5) : '',
    date: f ? (f.det === 'stack' ? sRange(f) : f.date.slice(0, 10)) : '', frameId: f?.obs || '', url: location.href };
}
$('insp').addEventListener('click', e => {
  const b = e.target.closest('.nb-plus[data-nb]'); if (!b) return;
  const k = b.dataset.nb, entry = k.startsWith('row:') ? NB_ROWS.get(k.slice(4)) : NB_VIEW[k]?.();
  if (!entry) { toast('Nothing to save here yet.'); Snd.play('error'); return; }
  try { notebookAdd({ ...entry, context: nbContext() }); } catch (err) { console.warn('notebook', err); toast("Couldn't save to the notebook."); Snd.play('error'); return; }
  b.classList.add('done'); setTimeout(() => b.classList.remove('done'), 1200);
  toast(`Saved to your lab notebook: ${entry.label.replace(/^[^:]+: /, '')}`); Snd.play('confirm');
});

/* ---------- observer location (opt-in, kept in memory only) ---------- */
// alt/az and rise/transit/set come from sky.js (precessed to date, −0.5667° horizon, current pass when up)
const hm = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); // 24-hour HH:MM, as on the planetarium
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
  renderLook(); // the plain "where to look" line follows the place
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
    ${row('Dark-sky viewing tonight', vis.hours > 0 ? `${vis.hours.toFixed(1)} h above 20°, best ${when(vis.bestTime)} (${vis.bestAlt.toFixed(0)}°)` : 'Not above 20° while it is dark', 'calc')}</div>
    <p class="obs-msg">Times in your browser's time zone. Worked out from your position and the clock; no internet needed.</p>`;
  $('clrLoc').onclick = () => { obs.loc = null; renderObs(); Snd.play('click'); };
  obsTimer = setInterval(renderObs, 30000);
}

/* ---------- "Where to look" in plain words (Master item 3) ----------
   One line for people who don't read RA/Dec: compass direction and height above the horizon now,
   then rise / highest / set, from Colombo by default or the place set under Observer (in memory only).
   Same maths as the Observer rows (sky.js). AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026. */
const LOOK_HOME = { lat: 6.927, lon: 79.861, label: 'Colombo' };
const lookPlace = () => obs.loc || LOOK_HOME;
const lookFrom = () => !obs.loc ? 'From Colombo' : obs.loc.label === 'Your device location' ? 'From where you are' : obs.loc.label === 'Typed position' ? 'From your place' : `From ${obs.loc.label}`;
// { head, day }: head = now (+ best time tonight), day = rise / highest / set.
// "Tonight" numbers and words come from sky.js skyTonight/tonightWords, the same ones the planetarium's card uses.
function whereToLook(ra, dec, now = new Date()) {
  const { lat, lon } = lookPlace(), from = lookFrom();
  const at = d => `${hm(d)}${dayTag(d) === 'today' ? '' : ' ' + dayTag(d)}`;
  const { alt, az } = altAz(ra, dec, lat, lon, now), st = skyTonight(ra, dec, lat, lon, now), w = tonightWords(st, dec, lat, at);
  if (w.kind === 'down') return { head: `${from}: ${w.bestText}.`, day: '' };
  const best = (w.kind === 'low' ? 'low tonight: ' : '') + w.bestText, darkNow = st.dark?.inDark;
  const head = alt > 0
    ? `${from} now: look ${dirWord(az)} (${az.toFixed(0)}°), ${alt.toFixed(0)}° up.${darkNow ? '' : ` It is not dark yet, so ${best}.`}`
    : `${from}: below the horizon now; ${best}.`;
  return { head, day: w.dayText };
}
// short form for hover readouts (cheap: no rise/set search)
function lookShort(ra, dec) {
  const { lat, lon } = lookPlace(), { alt, az } = altAz(ra, dec, lat, lon, new Date());
  return `${alt > 0 ? `${dirWord(az)}, ${alt.toFixed(0)}° up` : 'below the horizon'} now ${lookFrom().replace(/^From /, 'from ')}`;
}
// what we know about seeing an object with your own eyes: a demo star's catalogue V (presets.js) or a
// SIMBAD name lookup's V; undefined (no line) for a clicked patch or an object whose V we never fetched
function visOf(t) {
  if (!t) return undefined;
  if (t.preset) return t.preset.vis ?? null;
  if (t.presetKey) return PRESETS.find(p => p.key === t.presetKey)?.vis ?? null;
  const s = t.simbad || (t.source === 'SIMBAD' ? t : null);
  return s && 'vmag' in s ? (Number.isFinite(s.vmag) ? { v: s.vmag, source: 'SIMBAD' } : null) : undefined;
}
function seeHTML(vis) {
  if (vis === undefined) return '';
  const s = seeItWith(vis);
  return `<p class="cd-look-see" data-see="${s.level}">${esc(s.simple)}<span class="x-only"> ${esc(s.expert)}.</span></p>`;
}
function lookHTML(ra, dec, vis) {
  const w = whereToLook(ra, dec);
  return `<div class="cd-look" role="note"><p class="cd-look-h">${esc(w.head)}</p>${w.day ? `<p class="cd-look-d">${esc(w.day)}</p>` : ''}${seeHTML(vis)}
    <p class="cd-look-n">${obs.loc ? '' : 'Colombo is the default place. '}Times in your time zone. <button type="button" class="fl-link" data-look-place>Change place</button></p></div>`;
}
let lookTimer = 0;
function renderLook() {
  clearInterval(lookTimer);
  const s = M.sel; if (s && $('cdLook')) $('cdLook').innerHTML = lookHTML(s.ra, s.dec, visOf(s.t));
  // a moving star: its position now (as on the map and the planetarium), not the time-lapse centre
  const vt = V.target && (V.target.pmra || V.target.pmdec) ? propagate(V.target, NOW_MJD) : V.grid && { ra: V.grid.ra0, dec: V.grid.dec0 };
  if (vt && $('vLook')) $('vLook').innerHTML = lookHTML(vt.ra, vt.dec, visOf(V.target));
  lookTimer = setInterval(renderLook, 60000);
}
// "Change place": switch the Observer section on and put the cursor in its place field
$('insp').addEventListener('click', e => {
  if (!e.target.closest('[data-look-place]')) return;
  if (scene === 'viewer') toMap(true); // the Observer section lives in the map's details panel
  if (!obs.on) obsOn(true);
  $('obsSw').scrollIntoView({ block: 'center', behavior: set.motion ? 'auto' : 'smooth' });
  setTimeout(() => ($('placeIn') || $('obsSw')).focus({ preventScroll: true }), 300);
});

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
// Same range with its '…band' name (WAVE legend); one cached copy per range so identity checks still work
const namedCache = new WeakMap();
function namedRange(r) {
  if (!r) return r;
  let n = namedCache.get(r);
  if (!n || n.raw !== r.name || n.c !== r.c) { n = { ...r, raw: r.name, name: bandName(r) }; namedCache.set(r, n); }
  return n;
}
function hexRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function onColour(h) { const [r, g, b] = hexRgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return (.2126 * r + .7152 * g + .0722 * b) > .28 ? '#1A1410' : '#FFF8F0'; }
function colourDist(a, b) { const x = hexRgb(a), y = hexRgb(b); const rm = (x[0] + y[0]) / 2; return Math.sqrt((2 + rm / 256) * (x[0] - y[0]) ** 2 + 4 * (x[1] - y[1]) ** 2 + (2 + (255 - rm) / 256) * (x[2] - y[2]) ** 2); }
function warnings(r) {
  const w = [];
  if (!(r.min < r.max)) w.push('Min must be smaller than max.');
  ranges.forEach(o => { if (o !== r && r.min < o.max && o.min < r.max) w.push(`Overlaps ${esc(bandName(o))} (allowed).`); });
  ranges.forEach(o => { if (o !== r && colourDist(r.c, o.c) < 70) w.push(`Colour looks close to ${esc(bandName(o))}; the names still tell them apart.`); });
  return w;
}
let mbHeld = false; // "Hold to compare": the plain one-wavelength map while held
const mapLayers = () => layersFor(ranges.map(r => ({ on: true, min: r.min, max: r.max, color: r.c })));
function applyMapBands() {
  $('mapBandsSw').setAttribute('aria-checked', mapBands);
  $('mapBandsSee').hidden = !mapBands || scene === 'map';
  skymap.setBands(mapBands && !mbHeld ? mapLayers() : []);
  mapWlText();
  const key = $('mapBandsKey'); key.hidden = !mapBands;
  if (mapBands) {
    const n = mapLayers().reduce((s, l) => s + l.channels.length, 0);
    $('mapBandsNote').textContent = BAND_NOTE;
    key.setAttribute('aria-label', `Coloured by your IR band ranges. ${BAND_NOTE}.`);
    $('mapBandsList').innerHTML = ranges.map(r => `<span title="${esc(bandName(r))}: ${r.min.toFixed(2)}–${r.max.toFixed(2)} µm. ${BAND_NOTE}."><i style="--rc:${r.c}"></i><b class="mb-i" aria-hidden="true">${esc(bandInitials(r))}</b><em class="mb-n">${esc(bandName(r))}</em></span>`).join('');
    $('mapBandsHold').title = `Shows the plain ${$('wlOut').textContent} map while held. Painted now: ${n} SPHEREx wavelengths in ${ranges.length} colours.`;
  }
}
function holdMapBands(on) {
  if (!mapBands || mbHeld === on) return;
  mbHeld = on; $('mapBandsHold').setAttribute('aria-pressed', on); $('mapBandsHold').textContent = on ? `Plain ${$('wlOut').textContent}` : 'Hold to compare';
  applyMapBands();
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
  $('lanes').innerHTML = ranges.map(r => `<div class="lane"><div class="band" data-id="${r.id}" style="--c:${r.c};--on:${onColour(r.c)};left:${pct(r.min)}%;width:${Math.max(0, pct(r.max) - pct(r.min))}%" title="${esc(bandName(r) + (r.tip ? ': ' + r.tip : ''))}">
      <span class="h l" role="slider" tabindex="0" id="h-${r.id}-min" aria-label="${esc(bandName(r))} start" aria-valuemin="${DOMN[0]}" aria-valuemax="${DOMN[1]}" aria-valuenow="${r.min}" aria-valuetext="${r.min.toFixed(2)} micrometres"></span>
      <span class="bn">${esc(bandName(r))}</span>
      <span class="h r" role="slider" tabindex="0" id="h-${r.id}-max" aria-label="${esc(bandName(r))} end" aria-valuemin="${DOMN[0]}" aria-valuemax="${DOMN[1]}" aria-valuenow="${r.max}" aria-valuetext="${r.max.toFixed(2)} micrometres"></span></div></div>`).join('');
  $('rows').innerHTML = ranges.map(r => `<div class="rrow" data-id="${r.id}">
      <button class="swatch" style="--c:${r.c}" aria-label="Colour of ${esc(bandName(r))}: ${esc((PALETTE.find(p => p[1].toLowerCase() === r.c.toLowerCase()) || ['custom'])[0])}" aria-expanded="${openPal === r.id}"></button>
      <label class="field well" title="${esc(r.tip || '')}"><input class="rn" value="${esc(r.name)}" aria-label="Name" maxlength="32"></label>
      <label class="field well"><input class="rmin" type="number" step="0.01" min="${DOMN[0]}" max="${DOMN[1]}" value="${r.min.toFixed(2)}" aria-label="${esc(bandName(r))} from, micrometres"></label>
      <label class="field well"><input class="rmax" type="number" step="0.01" min="${DOMN[0]}" max="${DOMN[1]}" value="${r.max.toFixed(2)}" aria-label="${esc(bandName(r))} to, micrometres"></label>
      <button class="key icon rdel" aria-label="Delete ${esc(bandName(r))}"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9"/></svg></button>
      ${r.tip ? `<p>${esc(r.tip)}</p>` : ''}
      <div class="rwarn" role="status">${warnings(r).join(' ')}</div>
      ${openPal === r.id ? `<div class="palette well">${PALETTE.map(([nm, c]) => `<button style="--c:${c}" data-c="${c}" aria-label="${nm}" aria-pressed="${c.toLowerCase() === r.c.toLowerCase()}" title="${nm}"></button>`).join('')}
        <label class="field well"><input class="hex" value="${r.c}" aria-label="Hex colour" maxlength="7"></label></div>` : ''}
    </div>`).join('');
  $('beBandNote').textContent = BAND_NOTE;
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
    rowEl.querySelector('.rn').addEventListener('input', e => { r.name = e.target.value || 'Untitled'; r.tip = ''; saveRanges(); const b = $('lanes').querySelector(`[data-id="${r.id}"] .bn`); if (b) b.textContent = bandName(r); applyRanges(); });
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
    rowEl.querySelector('.rdel').onclick = () => { ranges = ranges.filter(x => x !== r); Snd.play('click'); commit(); toast(`Deleted ${bandName(r)}.`); };
    rowEl.querySelectorAll('.palette button').forEach(b => { b.onclick = () => { r.c = b.dataset.c; Snd.play('tick'); commit(); }; });
    const hex = rowEl.querySelector('.hex'); if (hex) hex.addEventListener('change', () => { const v = hex.value.trim(); if (hexRgb(v)) { r.c = v.startsWith('#') ? v : '#' + v; commit(); } else { warn.textContent = 'Use a hex colour like #C27A43.'; } });
  });
}
$('addRange').onclick = () => { if (ranges.length >= 8) { toast('Up to 8 ranges. Delete one first.'); return; } const used = ranges.map(r => r.c.toLowerCase()); const c = (PALETTE.find(p => !used.includes(p[1].toLowerCase())) || PALETTE[0])[1];
  ranges.push({ id: 'r' + Date.now().toString(36), name: `Range ${ranges.length + 1}`, min: 2.0, max: 2.5, c }); Snd.play('click'); commit(); };
$('resetRanges').onclick = () => { ranges = JSON.parse(JSON.stringify(DEFAULT_RANGES)); openPal = null; Snd.play('click'); commit(); toast('Default ranges restored.'); };
function setMapBands(on) { mapBands = on; mbHeld = false; $('mapBandsHold').setAttribute('aria-pressed', 'false'); $('mapBandsHold').textContent = 'Hold to compare'; try { localStorage.setItem(MKEY, on ? 'on' : 'off'); } catch { /* ignore */ } applyMapBands(); Snd.play('click'); }
$('mapBandsSw').onclick = () => setMapBands(!mapBands);
$('mapBandsSee').onclick = () => { closePop(); toMap(false); };
$('mapBandsOff').onclick = () => { setMapBands(false); toast('Sky map back to one wavelength.'); };
{ const h = $('mapBandsHold'), up = () => holdMapBands(false);
  h.addEventListener('pointerdown', e => { h.setPointerCapture?.(e.pointerId); holdMapBands(true); });
  ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'].forEach(ev => h.addEventListener(ev, up));
  h.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); holdMapBands(true); } });
  h.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') up(); }); }
function openBands() {
  const pop = $('bands'), btn = $('bandTool'); closePop(); const r = btn.getBoundingClientRect(); pop.hidden = false;
  $('mapBandsSee').hidden = !mapBands || scene === 'map';
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
  $('hitStar').hidden = !!f.ringOff;
  Object.assign($('hitStar').style, { left: ((ex + .5) * cssCell - rad) + 'px', top: ((ey + .5) * cssCell - rad) + 'px', width: 2 * rad + 'px', height: 2 * rad + 'px' });
  $('hitOther').hidden = !otherPx; if (!otherPx) return;
  const [ox, oy] = otherPx, rr = Math.max(1.5 * cssCell, mq('(max-width: 699px)') ? 22 : 0); // phone: 44 px tap box; the drawn ring keeps its size
  Object.assign($('hitOther').style, { left: ((ox + .5) * cssCell - rr) + 'px', top: ((oy + .5) * cssCell - rr) + 'px', width: 2 * rr + 'px', height: 2 * rr + 'px' });
}
bindTip($('hitStar'), () => `<b>${esc(V.ring && !V.ring.own ? V.ring.name : V.name)}</b><small>${V.ring && !V.ring.own ? 'Inside the dashed ring: where this catalogued star should be on this date' : V.target?.pmra || V.target?.pmdec ? 'Inside the dashed ring (predicted position)' : 'Centre of the patch'}</small>`);
// The 'Where it should be' section says whose ring it is, or that a picked patch has none
function ringPanel() {
  const own = !V.ring || V.ring.own, note = $('ringNote'); if (!note) return;
  note.textContent = !V.ring ? 'This is a patch picked on the sky, not a catalogued star, so there is no predicted position to draw.'
    : own ? "The dashed ring is worked out from the star's catalogue motion for this date."
    : `The dashed ring shows where ${V.ring.name} should be on each image's date, from its catalogue motion (it is inside this patch). It is hidden on images where the star is off the edge.`;
  $('ringRow').hidden = !V.ring;
  $('ringTool').disabled = !V.ring; // nothing to ring on an empty patch
}
bindTip($('hitOther'), () => otherName ? `<b>${esc(otherName.name)}</b><small>${esc(otherName.type)} · SIMBAD, ${otherName.sep.toFixed(0)}″ from the bright spot</small>`
  : otherName === false ? '<b>Unidentified source</b><small>No SIMBAD object within 15″ of this bright spot.</small>' : '<b>Looking it up…</b><small>Asking SIMBAD</small>');

/* ---------- scenes: map → (zoom) → flip-book ---------- */
// then(): runs inside the transition's update, after the map's "old" picture is taken. load() used to
// run straight after startViewTransition(), so the loader was already over the map in the old picture.
function toViewer(instant, then) {
  let ran = false; // a page that is not drawing (e.g. a hidden pane) never runs the transition's update: run it anyway after 600 ms
  if (!instant) setTimeout(() => go(), 600);
  const go = () => { if (ran) return; ran = true; scene = 'viewer'; app.dataset.scene = 'viewer'; then?.(); hideTip(); layout(); onFrame(P.i); placeHits(); GH.placeMap(); if (innerWidth < 1100) sheet(false); updateURL(); };
  if (!instant && document.startViewTransition && !set.motion) viewTransition(go); else go();
}
function toMap(instant) {
  const go = () => { scene = 'map'; app.dataset.scene = 'map'; P.pause(); clearInterval(bt); hideTip(); closePop(); GH.syncKey(); GH.renderCD(); requestAnimationFrame(GH.placeMap); requestAnimationFrame(placeOverlays); updateURL(); if (M.sel) setCoordText(M.sel.ra, M.sel.dec); };
  if (!instant) Snd.play('tick');
  if (!instant && document.startViewTransition && !set.motion) viewTransition(go); else go();
}
function playPatch() {
  const s = M.sel; if (!s) return;
  Snd.play('click');
  const t = s.t, preset = t?.preset;
  const query = preset ? { type: 'name', name: preset.label } : t?.simbad ? { type: 'name', name: t.simbad.name } : { type: 'coords', ra: s.ra, dec: s.dec };
  const same = V.query && JSON.stringify(V.query) === JSON.stringify(query) && V.status === 'ready';
  if (skymap.aladin && !set.motion) skymap.setFov(Math.max(0.05, (150 / 3600) / 0.42));
  setTimeout(() => toViewer(false, same ? null : () => load(query, t ? t.name : PATCH_NAME)), set.motion ? 0 : 250);
}
$('cdPlay').onclick = playPatch; $('mdPlay').onclick = playPatch;
// Desktop dock row 2: say in words what the chosen layer shows (review 2, item 10)
{ const seg = $('layerSeg'), hint = () => { const b = seg.querySelector('[aria-pressed="true"]'); $('layerHint').innerHTML = b ? `<b>${esc(b.textContent.toLowerCase())}</b> · ${esc(b.title.charAt(0).toLowerCase() + b.title.slice(1))}` : ''; };
  hint(); new MutationObserver(hint).observe(seg, { attributes: true, subtree: true, attributeFilter: ['aria-pressed'] }); }
// Wide screens show the details panel's copper Play key beside the dock, so the dock's is plain there (review 2, item 8)
{ const ph = matchMedia('(max-width: 1099px)'), f = () => $('mdPlay').classList.toggle('primary', ph.matches); f(); ph.addEventListener('change', f); }
 $('mapBack').onclick = () => toMap(false);

/* ---------- map colour (wavelength) ---------- */
function setWl(ch) { skymap.setChannel(ch); const um = CHANNEL_UM[ch].toFixed(2) + ' µm'; $('wlOut').textContent = um; mapWlText(); }
// Map credit and dock slider say what the map shows: one wavelength, or the band paint (review 2, item 2)
function mapWlText() {
  const painted = mapBands && !mbHeld, um = $('wlOut').textContent;
  $('mapWl').textContent = painted ? 'coloured by your band ranges' : `at ${um}`;
  $('wlLbl').textContent = mapBands ? 'Plain map' : 'Map colour';
  $('wlHint').hidden = !mapBands;
  $('wl').closest('.wl-rd').classList.toggle('wl-off', mapBands);
}
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
  pinEls.forEach((p, i) => { const t = TARGETS[i]; bindTip(p, () => `<b>${esc(t.name)}</b><small>${esc(t.id)}</small><small>${esc(lookShort(t.ra, t.dec))}</small>`); p.onclick = () => select(t.ra, t.dec, t, true); });
  $('pins').style.cssText = 'position:absolute;inset:0;pointer-events:none'; pinEls.forEach(p => { p.style.pointerEvents = 'auto'; });
  $('sel').hidden = true;
  app.dataset.scene = 'map';
  applySettings(); buildTimeline(); layout();
  const qp = new URLSearchParams(location.search);
  if (qp.get('scene') === 'viewer' && qp.get('mjd') && Number.isFinite(+qp.get('mjd'))) holdMjd = +qp.get('mjd');
  if (qp.get('scene') === 'viewer' && VIEW_MODES.includes(qp.get('view'))) wantView = qp.get('view');
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
