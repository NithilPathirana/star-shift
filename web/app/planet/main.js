// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// "Sky now" planetarium page (DESIGN.md section 26): wiring for place, time, view, picking.
// Privacy: the place is kept in memory only. It is never stored, put in the URL or sent.
import { observer, bodies, packStars, horMatrix, starsToHorizon, starAltAz, altAzToRaDec, vecToAltAz,
  sunAltitude, lstHours, passTimes, bvColor, starSize, starAlpha } from './astro.js';
import { makeView, unproject, zoomAbout } from './projection.js';
import { draw } from './render.js';
import { OBSERVATORIES, NASA_CENTRES, DEFAULT_PLACE, ALL_PRESETS, parsePlace, fmtLat, fmtLon } from './places.js';
import { smallBodies, onProvidersChanged } from './extras.js';
import { initAir, updateAir } from './atmo-ui.js';
import './jpl-small.js'; // registers the JPL Horizons provider for Ceres, Pallas, Juno and Vesta
import { answer as tonightAnswer, starAnswer } from './tonight.js';
import { propagate } from '../../core/motion.js';
import { findPreset } from '../presets.js';
import { seeItWith } from '../seeit.js'; // can you actually see it (V magnitude), apart from 'is it up'
import { resolveName } from '../../core/resolve.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mq = (q) => matchMedia(q).matches;
const FOV_MIN = 0.5, FOV_MAX = 100;

/* ---------- Clarity (shared with the Viewer through the same localStorage key) ---------- */
const KEY = 'tgi-clarity-v1';
let stored = {}; try { stored = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* private mode */ }
const set = Object.assign({ motion: mq('(prefers-reduced-motion: reduce)'), glass: mq('(prefers-reduced-transparency: reduce)'),
  contrast: mq('(prefers-contrast: more)'), text: false }, stored);
function applySettings() {
  root.dataset.motion = set.motion ? 'reduce' : 'full'; root.dataset.glass = set.glass ? 'solid' : 'glass';
  root.dataset.contrast = set.contrast ? 'more' : 'normal'; root.dataset.text = set.text ? 'large' : 'normal';
  document.querySelectorAll('[data-set]').forEach(b => b.setAttribute('aria-checked', !!set[b.dataset.set]));
  if (set.motion && S.playing) setPlaying(false);
  $('playBtn').disabled = !!set.motion; $('playBtn').title = set.motion ? 'Time never runs by itself with Reduce motion on' : '';
}
document.querySelectorAll('[data-set]').forEach(b => b.onclick = () => {
  set[b.dataset.set] = !set[b.dataset.set];
  try { const cur = JSON.parse(localStorage.getItem(KEY)) || {}; localStorage.setItem(KEY, JSON.stringify({ ...cur, [b.dataset.set]: set[b.dataset.set] })); } catch { /* private mode */ }
  applySettings(); layout();
});

/* ---------- state ---------- */
const qp = new URLSearchParams(location.search);
const S = {
  place: ALL_PRESETS.find(p => p.id === qp.get('place')) || DEFAULT_PLACE,
  anchor: null,         // Date the slider is relative to; null = follow "now"
  offsetMin: 0,         // slider, minutes
  view: { az: 180, alt: 40, fov: 90 },
  opt: { grid: true, labels: true, below: false },
  stars: null, bodies: [], small: [], sel: null, picks: null,
  playing: false, rate: 600, w: 0, h: 0, dpr: 1, dirty: true,
};
const tParam = qp.get('t'); if (tParam && !Number.isNaN(Date.parse(tParam))) S.anchor = new Date(tParam);
const curTime = () => new Date((S.anchor ? S.anchor.getTime() : Date.now()) + S.offsetMin * 60000);
let obs = observer(S.place.lat, S.place.lon, S.place.elev || 0);

/* ---------- time zones (offline: Intl only) ---------- */
function tzOffsetMin(tz, d) { // minutes east of UTC for an IANA zone at instant d
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).filter(x => x.type !== 'literal').map(x => [x.type, +x.value]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000) / 60000;
}
// Offset for the place: its IANA zone if known, else local mean solar time from longitude.
const placeOffset = (d) => S.place.tz ? tzOffsetMin(S.place.tz, d) : Math.round(S.place.lon * 4);
const pad = (n) => String(n).padStart(2, '0');
function wall(d) { const w = new Date(d.getTime() + placeOffset(d) * 60000); return { y: w.getUTCFullYear(), mo: w.getUTCMonth(), d: w.getUTCDate(), h: w.getUTCHours(), mi: w.getUTCMinutes() }; }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtLocal(d, withDate = true) { const w = wall(d); return (withDate ? `${w.d} ${MON[w.mo]} ` : '') + `${pad(w.h)}:${pad(w.mi)}`; }
function fmtUtc(d) { return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }
function dayWord(d, ref) {
  const a = wall(d), b = wall(ref), diff = Math.round((Date.UTC(a.y, a.mo, a.d) - Date.UTC(b.y, b.mo, b.d)) / 86400000);
  return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff === -1 ? 'yesterday' : `${a.d} ${MON[a.mo]}`;
}
function wallToDate(str) { // "YYYY-MM-DDTHH:MM" in the place's local time -> Date
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(str); if (!m) return null;
  const guessUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = guessUtc - placeOffset(new Date(guessUtc)) * 60000;
  t = guessUtc - placeOffset(new Date(t)) * 60000;
  return new Date(t);
}
function dateToWallInput(d) { const w = wall(d); return `${w.y}-${pad(w.mo + 1)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`; }
function offsetLabel(min) {
  if (!S.anchor && min === 0) return 'Now';
  const sgn = min < 0 ? '−' : '+', a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
  return min === 0 ? 'Chosen time' : `${sgn}${h} h ${pad(m)} min`;
}

/* ---------- stars ---------- */
async function loadStars() {
  const res = await fetch(new URL('../data/stars.json', import.meta.url));
  const data = await res.json(), rows = data.stars, n = rows.length;
  const st = { eqj: packStars(rows), hor: new Float32Array(n * 3), mag: new Float32Array(n), bv: new Float32Array(n), hip: new Int32Array(n),
    size: new Float32Array(n), alpha: new Float32Array(n), color: new Array(n), names: new Map(), named: [], ra: new Float64Array(n), dec: new Float64Array(n) };
  const colorCache = new Map();
  rows.forEach((r, i) => {
    st.hip[i] = r[0]; st.ra[i] = r[1]; st.dec[i] = r[2]; st.mag[i] = r[3]; st.bv[i] = r[4] ?? NaN;
    st.size[i] = starSize(r[3]); st.alpha[i] = starAlpha(r[3]);
    const ck = Math.round((Number.isFinite(r[4]) ? r[4] : 0.6) * 20); // 0.05 steps
    if (!colorCache.has(ck)) colorCache.set(ck, bvColor(ck / 20)); st.color[i] = colorCache.get(ck);
    const nm = data.names[r[0]]; if (nm) { st.names.set(i, nm); st.named.push(i); }
  });
  st.named.sort((a, b) => st.mag[a] - st.mag[b]);
  S.stars = st; S.starCredit = data.credit;
}

/* ---------- recompute the sky for the current time and place ---------- */
let smallSeq = 0, smallTimer = 0;
function recompute() {
  const t = curTime();
  if (S.stars) starsToHorizon(S.stars.eqj, horMatrix(t, obs), S.stars.hor);
  S.bodies = bodies(t, obs);
  S.small = S.smallRaw ? S.smallRaw.map(b => ({ ...b, ...starAltAz(b.ra, b.dec, t, obs) })) : [];
  clearTimeout(smallTimer); smallTimer = setTimeout(fetchSmall, 400);
  updateClock(t); updateDay(t); updateSel(t); S.dirty = true;
  updateAir({ place: S.place, sel: S.sel, time: t }); // "What gets through the air" (31b), throttled inside
}
async function fetchSmall() { // hook for JPL asteroids/comets (extras.js); gets the time only
  const my = ++smallSeq, list = await smallBodies(curTime());
  if (my !== smallSeq) return;
  S.smallRaw = list; const t = curTime();
  S.small = list.map(b => ({ ...b, ...starAltAz(b.ra, b.dec, t, obs) })); S.dirty = true;
}
onProvidersChanged(() => fetchSmall());

function updateClock(t) {
  $('tLocal').textContent = fmtLocal(t); $('tUtc').textContent = fmtUtc(t);
  $('dockTime').textContent = `${fmtLocal(t)} local · ${fmtUtc(t)} UTC`;
  const l = lstHours(t, S.place.lon), lh = Math.floor(l), lm = Math.floor((l - lh) * 60);
  $('tLst').textContent = `${pad(lh)}:${pad(lm)}`;
  $('offOut').textContent = offsetLabel(S.offsetMin);
  $('tSlider').setAttribute('aria-valuetext', offsetLabel(S.offsetMin));
  if (document.activeElement !== $('tDate')) $('tDate').value = dateToWallInput(t);
}
function updateDay(t) {
  const up = sunAltitude(t, obs) > 0;
  $('dayChip').hidden = !up;
}

/* ---------- place ---------- */
function setPlace(p) {
  S.place = p; obs = observer(p.lat, p.lon, p.elev || 0);
  $('placeName').textContent = p.name;
  $('plLat').textContent = fmtLat(p.lat); $('plLon').textContent = fmtLon(p.lon);
  const tz = $('plTz');
  if (p.tz) { tz.textContent = p.tz.replace(/_/g, ' '); tz.removeAttribute('title'); }
  else { tz.textContent = 'solar time'; tz.title = 'No time zone is known for typed coordinates, so local times are local mean solar time (UTC + longitude ÷ 15).'; }
  S.view = { ...S.view, az: p.lat < 0 ? 0 : 180, alt: 40 };
  S.sel = null; renderSel(); recompute();
  announce(`Sky from ${p.name}`);
}

/* ---------- selection (details panel) ---------- */
const TAG = { c: '<span class="tag tag-calc">COMPUTED</span>', cat: '<span class="tag pl-tag-cat">CATALOGUE</span>', jpl: '<span class="tag pl-tag-cat">JPL</span>' };
const dash = (why) => `<span class="pl-miss" title="${esc(why)}" tabindex="0">—<span class="sr-only"> (${esc(why)})</span></span>`;
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (az) => COMPASS[Math.round(az / 22.5) % 16];

function selAltAz(sel, t) {
  if (sel.kind === 'sun' || sel.kind === 'moon' || sel.kind === 'planet') return S.bodies.find(b => b.key === sel.key) || sel;
  if (sel.kind === 'small') return S.small.find(b => b.key === sel.key) || sel;
  return { ...sel, ...starAltAz(sel.ra, sel.dec, t, obs) };
}
let selTimer = 0, lastSelT = 0;
function updateSel(t) {
  if (!S.sel) return;
  Object.assign(S.sel, selAltAz(S.sel, t));
  const now = performance.now();
  if (S.playing && now - lastSelT < 300) { clearTimeout(selTimer); selTimer = setTimeout(() => renderSel(), 320); return; }
  lastSelT = now; renderSel();
}
// Rows carry no tags; each group heading shows its source tag once (DESIGN.md section 25).
function row(label, value) { return `<dt>${label}</dt><dd>${value}</dd>`; }
// Distance from a catalogue parallax in milliarcseconds: 1000 / plx parsecs, 3.26156 light-years per parsec.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
function fmtDistance(plxMas) {
  const ly = (1000 / plxMas) * 3.26156;
  const txt = ly < 100 ? ly.toPrecision(3) : Math.round(ly).toLocaleString('en-GB');
  return `${txt} light-years`;
}
const group = (title, tag, body) => `<div class="ih pl-grp"><h3>${title}</h3>${tag || ''}</div><dl class="pl-dl">${body}</dl>`;
function fmtRA(deg) { // 00h 34m 15.3s
  let s = ((deg % 360) + 360) % 360 / 15 * 3600; s = Math.round(s * 10) / 10; if (s >= 86400) s -= 86400;
  const h = Math.floor(s / 3600), mi = Math.floor((s - h * 3600) / 60), se = s - h * 3600 - mi * 60;
  return `${pad(h)}h ${pad(mi)}m ${se.toFixed(1).padStart(4, '0')}s`;
}
function fmtDec(deg) { // +00° 48′ 49″
  let s = Math.round(Math.abs(deg) * 3600); const d = Math.floor(s / 3600), mi = Math.floor((s - d * 3600) / 60), se = s - d * 3600 - mi * 60;
  return `${deg < 0 ? '−' : '+'}${pad(d)}° ${pad(mi)}′ ${pad(se)}″`;
}
function renderSel() {
  const sel = S.sel, rows = $('selRows'), play = $('playPatch'), why = $('playWhy');
  if (!sel) {
    $('selKind').textContent = 'Pick something'; $('selName').textContent = 'Click a planet, a star or any spot';
    $('selHint').hidden = false; rows.hidden = true; play.hidden = true; why.hidden = true; S.dirty = true; return;
  }
  const t = curTime(), isBody = ['sun', 'moon', 'planet', 'small'].includes(sel.kind);
  $('selKind').textContent = { sun: 'Star (our Sun)', moon: 'Moon', planet: 'Planet', small: 'Asteroid or comet', star: 'Star', point: 'Spot on the sky' }[sel.kind];
  $('selName').textContent = sel.name; $('selHint').hidden = true;
  const src = sel.kind === 'small' ? TAG.jpl : TAG.c;
  let h = group('Now from here', src, row('Altitude', `${sel.alt.toFixed(1)}°`) + row('Azimuth', `${sel.az.toFixed(1)}° ${compass(sel.az)}`));
  let pass = null, p = '';
  // stars and spots: rise / highest / set from the shared sky.js maths (same numbers as the viewer's "Where to look")
  try { pass = isBody ? (sel.kind === 'small' ? passTimes({ kind: 'point', ra: sel.ra, dec: sel.dec }, t, obs) : passTimes(sel, t, obs)) : starTonight(sel, t).st.rts; } catch { pass = null; }
  if (!pass) p = row('Rise', dash('Could not be computed')) + row('Highest', dash('Could not be computed')) + row('Set', dash('Could not be computed'));
  else if (pass.always) {
    const w = pass.always === 'up' ? 'Never sets from here' : 'Never rises from here';
    p = row('Rise', dash(w)) + row('Highest', pass.transit ? `${fmtLocal(pass.transit, false)} ${dayWord(pass.transit, t)} · ${pass.transitAlt.toFixed(0)}°` : dash(w)) + row('Set', dash(w));
    p += `<dt></dt><dd class="pl-note">${w}</dd>`;
  } else {
    const tm = (d, why) => d ? `${fmtLocal(d, false)} ${dayWord(d, t)}` : dash(why);
    p = row('Rise', tm(pass.rise, 'No rise in the 24 hours searched'))
      + row('Highest', pass.transit ? `${tm(pass.transit)} · ${pass.transitAlt.toFixed(0)}°` : dash('Not found in the next day'))
      + row('Set', tm(pass.set, 'No set in the 24 hours searched'));
  }
  h += group('Rise and set', pass ? TAG.c : '', p);
  const otag = sel.kind === 'star' ? TAG.cat : src;
  let o = '';
  if (sel.kind === 'moon') o += row('Distance', `${Math.round(sel.distAU * 149597870.7).toLocaleString('en-GB')} km`);
  else if (isBody) o += row('Distance', Number.isFinite(sel.distAU) ? `${sel.distAU.toFixed(3)} AU` : dash('Not given by the source'));
  else if (sel.kind === 'star' && sel.plx > 0) o += row('Distance', fmtDistance(sel.plx)); // built-in target: catalogue parallax (presets.js)
  else if (sel.kind === 'star') o += row('Distance', dash(sel.fromQuery ? 'Not looked up on this page' : 'Not in this star list (positions and brightness only)'));
  if (sel.kind === 'point') o += row('Brightness', dash('A spot on the sky, not an object'));
  else if (Number.isFinite(sel.mag)) o += row('Brightness', `mag ${sel.mag.toFixed(sel.kind === 'star' ? 2 : 1)}`);
  else if (sel.vis) { const e = seeItWith(sel.vis).expert; o += /^V /.test(e) ? row('Brightness', esc(e)) : row('Brightness', dash(e)); } // the same V (and source) as "To see it"
  else if (sel.vis === null) o += row('Brightness', dash('No visible-light (V) magnitude in the catalogue'));
  else o += row('Brightness', dash('Not given by the source'));
  if (sel.kind === 'moon' && Number.isFinite(sel.phase)) o += row('Lit', `${Math.round(sel.phase * 100)}%`);
  // RA/Dec are Expert detail (as on the viewer); Simple says where they are
  o += `<dt class="x-only">RA (J2000)</dt><dd class="x-only"><span class="num">${fmtRA(sel.ra)}</span></dd><dt class="x-only">Dec (J2000)</dt><dd class="x-only"><span class="num">${fmtDec(sel.dec)}</span></dd>`
    + `<dt class="s-only"></dt><dd class="s-only pl-note">Sky coordinates (RA, Dec) are in Expert mode.</dd>`;
  h += group(sel.kind === 'point' ? 'This spot' : 'Position and size', otag, o);
  rows.innerHTML = h; rows.hidden = false; // rows is a <div> holding grouped <dl>s
  if (isBody) { // the time-lapse shows one fixed patch; Solar System objects move out of it
    play.hidden = true; why.hidden = false; why.textContent = 'The time-lapse holds one fixed patch of sky, so it cannot follow objects in our Solar System.';
  } else {
    play.hidden = false; why.hidden = true;
    play.href = sel.fromQuery && sel.query ? `index.html?q=${encodeURIComponent(sel.query)}&scene=viewer` : `index.html?ra=${sel.ra.toFixed(5)}&dec=${sel.dec.toFixed(5)}&scene=viewer`;
  }
  renderAnswer();
  S.dirty = true;
}
/* ---------- "Can I see it tonight?" answer card (top of the details panel) ---------- */
// Stars and spots: tonight's numbers and words from sky.js via starAnswer (the viewer uses the same), cached per minute.
let stKey = '', stVal = null;
function starTonight(sel, t) {
  const key = `${sel.ra}|${sel.dec}|${S.place.lat}|${S.place.lon}|${S.place.id}|${Math.floor(t.getTime() / 60000)}`;
  if (key !== stKey) {
    const at = (d) => { const w = dayWord(d, t); return `${fmtLocal(d, false)}${w === 'today' ? '' : ' ' + w}`; };
    const ans = starAnswer({ ra: sel.ra, dec: sel.dec, lat: S.place.lat, lon: S.place.lon, date: t, place: S.place.id === 'me' ? 'your location' : S.place.name, at });
    stKey = key; stVal = { st: ans.st, ans };
  }
  return stVal;
}
let ansKey = '', ansMsg = null;
function showAnswer(head, detail, verdict, see) {
  const el = $('answer'); el.hidden = !head; if (!head) return;
  el.dataset.verdict = verdict || ''; $('ansHead').textContent = head; $('ansDetail').textContent = detail || '';
  // 'is it up' (above) is kept apart from 'can you actually see it' (web/app/seeit.js)
  const se = $('ansSee'); if (se) { se.hidden = !see; se.dataset.see = see?.level || ''; // a variable star's line already carries its V range: Expert then adds only where V comes from
    const ex = see && /\(it varies, V /.test(see.simple) ? see.expert.replace(/^V [^(]*\(([^)]*)\)$/, 'V from $1') : see?.expert;
    se.innerHTML = see ? `${esc(see.simple)}<span class="x-only"> ${esc(ex)}.</span>` : ''; }
}
function renderAnswer() {
  const sel = S.sel;
  if (!sel) { if (ansMsg) showAnswer(ansMsg.head, ansMsg.detail, 'msg'); else showAnswer(null); return; }
  if (sel.kind === 'sun') { showAnswer(null); return; }
  const t = curTime(), key = `${sel.key || sel.name}|${sel.ra}|${sel.dec}|${S.place.id}|${S.place.lat}|${S.place.lon}|${Math.floor(t.getTime() / 300000)}`;
  if (key === ansKey) return; ansKey = key;
  const body = sel.kind === 'moon' || sel.kind === 'planet';
  if (sel.kind === 'star' || sel.kind === 'point') { // one definition with the viewer (sky.js): dark = Sun below -12°, best = highest while dark
    // V known for demo stars, SIMBAD lookups and catalogue stars (Hipparcos V); none for a typed position
    const vis = sel.vis !== undefined ? sel.vis : Number.isFinite(sel.mag) ? { v: sel.mag, source: 'Hipparcos' } : undefined;
    try { const a = starTonight(sel, t).ans, see = vis === undefined ? null : seeItWith(vis);
      // 'Yes' answers 'is it up'; for an object nobody can see without an infrared telescope, say only that it is up
      const head = see?.level === 'faint' ? a.head.replace(/^Yes, /, 'Up in the sky, ') : a.head;
      showAnswer(head, a.detail + (S.place.tz ? '' : ' Times are local solar time.'), a.verdict, see); }
    catch { showAnswer('Could not work out tonight for this place', '', 'msg'); }
    return;
  }
  const altFn = body ? (d) => bodies(d, obs).find(b => b.key === sel.key)?.alt : (d) => starAltAz(sel.ra, sel.dec, d, obs).alt;
  try {
    const a = tonightAnswer({ altFn, date: t, obs, place: S.place.id === 'me' ? 'your location' : S.place.name, fmt: (d) => fmtLocal(d, false), stepMin: body ? 6 : 3 });
    showAnswer(a.head, a.detail + (S.place.tz ? '' : ' Times are local solar time.'), a.verdict);
  } catch { showAnswer('Could not work out tonight for this place', '', 'msg'); }
}
// Opened with an object (?q=<name> or ?ra=&dec=): find it, select it and turn the sky to it.
async function openFromQuery() {
  const q = (qp.get('q') || '').trim(), ra = Number(qp.get('ra')), dec = Number(qp.get('dec'));
  let t = null;
  if (q) {
    const body = S.bodies.find(b => b.name.toLowerCase() === q.toLowerCase());
    if (body) { select(body); face(S.sel); return; }
    const p = findPreset(q);
    // a moving demo star at its mid-Nov 2026 position (MJD 61360), exactly where the viewer and map put it
    if (p) { const n = propagate(p.target, 61360); t = { name: p.target.name, ra: n.ra, dec: n.dec, plx: p.target.plx, vis: p.vis ?? null }; }
    else {
      ansMsg = { head: `Looking up “${q}”…`, detail: 'Asking SIMBAD for its position.' }; renderAnswer();
      try { const r = await resolveName(q, { signal: AbortSignal.timeout(15000) }); if (r && Number.isFinite(r.ra)) t = { name: r.name, ra: r.ra, dec: r.dec, vis: Number.isFinite(r.vmag) ? { v: r.vmag, source: 'SIMBAD' } : null }; } catch { /* below */ }
      if (!t) { ansMsg = { head: `We couldn't find “${q}”`, detail: 'SIMBAD did not know this name or did not answer. Pick an object on the sky instead.' }; if (!S.sel) renderAnswer(); return; }
    }
  } else if (qp.has('ra') && qp.has('dec') && Number.isFinite(ra) && Number.isFinite(dec) && Math.abs(dec) <= 90) {
    t = { name: `RA ${(((ra % 360) + 360) % 360).toFixed(3)}°, Dec ${dec >= 0 ? '+' : '−'}${Math.abs(dec).toFixed(3)}°`, ra: ((ra % 360) + 360) % 360, dec };
  }
  if (!t) return;
  ansMsg = null;
  if (S.sel) return; // the user already picked something while we were looking it up
  select({ kind: 'star', key: 'q:' + t.ra.toFixed(5) + ',' + t.dec.toFixed(5), name: t.name, ra: t.ra, dec: t.dec, mag: null, fromQuery: true, query: q || null, plx: t.plx ?? null, vis: t.vis });
  face(S.sel);
  if (innerWidth < 700) toggleInsp(true); // phone: the answer lives in the details sheet, so open it once
}
function face(o) { // turn the view to the object; below the horizon, face its direction just above the ground
  if (!o || !Number.isFinite(o.az)) return;
  S.view.az = o.az; S.view.alt = clampAlt(Math.max(8, Math.min(75, o.alt))); S.dirty = true;
}
function select(obj) { if (obj) Object.assign(obj, selAltAz(obj, curTime())); S.sel = obj; renderSel(); updateAir({ place: S.place, sel: S.sel, time: curTime() }, true); if (obj) announce(`${obj.name} selected`); }

/* ---------- picking ---------- */
function pickAt(px, py, forClick) {
  const pk = S.picks; if (!pk) return null;
  let best = null, bd = 1e9;
  for (const b of pk.bodies) { const d = Math.hypot(b.x - px, b.y - py); if (d < b.r + 4 && d < bd) { bd = d; best = b.b; } }
  if (best) return best;
  const R = forClick ? 12 : 10; let bi = -1; bd = 1e9;
  for (let k = 0; k < pk.n; k++) {
    const d = Math.hypot(pk.x[k] - px, pk.y[k] - py); if (d > R) continue;
    const score = d + S.stars.mag[pk.i[k]] * 1.5; // prefer bright stars
    if (score < bd) { bd = score; bi = pk.i[k]; }
  }
  if (bi < 0) return null;
  const st = S.stars, nm = st.names.get(bi);
  return { kind: 'star', key: 'hip' + st.hip[bi], name: nm ? `${nm} (HIP ${st.hip[bi]})` : `HIP ${st.hip[bi]}`, ra: st.ra[bi], dec: st.dec[bi], mag: st.mag[bi] };
}
function pointAt(px, py) {
  const v = makeView({ ...S.view, w: S.w, h: S.h }), u = unproject(v, px, py), aa = vecToAltAz(...u);
  const rd = altAzToRaDec(aa.alt, aa.az, curTime(), obs);
  return { kind: 'point', name: `RA ${rd.ra.toFixed(3)}°, Dec ${rd.dec >= 0 ? '+' : '−'}${Math.abs(rd.dec).toFixed(3)}°`, ra: rd.ra, dec: rd.dec, alt: aa.alt, az: aa.az, mag: null };
}
function showTip(px, py) {
  const o = pickAt(px, py, false), tip = $('tip');
  if (!o) { tip.hidden = true; $('sky').style.cursor = 'grab'; return; }
  const a = o.alt ?? starAltAz(o.ra, o.dec, curTime(), obs).alt;
  const mag = Number.isFinite(o.mag) ? ` · mag ${o.mag.toFixed(1)}` : '';
  const nm = o.kind === 'moon' && Number.isFinite(o.phase) ? `Moon · ${Math.round(o.phase * 100)}% lit` : o.name;
  tip.innerHTML = `<b>${esc(nm)}</b><span class="num">alt ${a.toFixed(1)}°${mag}</span>`;
  tip.hidden = false; $('sky').style.cursor = 'pointer';
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = Math.min(S.w - tw - 8, px + 14) + 'px'; tip.style.top = Math.max(8, py - th - 10) + 'px';
}

/* ---------- view: drag (with inertia), wheel and pinch zoom, keys ---------- */
const canvas = $('sky'), ctx = canvas.getContext('2d');
const ptrs = new Map(); let drag = null, vel = { az: 0, alt: 0 }, pinch = null;
const clampAlt = (a) => Math.max(-30, Math.min(89.5, a));
const degPerPx = () => 57.2958 / makeView({ ...S.view, w: S.w, h: S.h }).scale; // at the centre
function setFov(f, px, py) {
  f = Math.max(FOV_MIN, Math.min(FOV_MAX, f));
  if (px != null) { const c = zoomAbout(makeView({ ...S.view, w: S.w, h: S.h }), px, py, f); S.view.az = c.az; S.view.alt = clampAlt(c.alt); }
  S.view.fov = f; $('fovOut').textContent = (f >= 10 ? f.toFixed(0) : f.toFixed(1)) + '°'; S.dirty = true;
}
function rel(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, rel(e)); vel = { az: 0, alt: 0 };
  if (ptrs.size === 1) drag = { start: rel(e), last: rel(e), t: performance.now(), moved: false };
  else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), fov: S.view.fov }; drag = null; }
  canvas.style.cursor = 'grabbing'; $('tip').hidden = true;
});
canvas.addEventListener('pointermove', (e) => {
  const p = rel(e);
  if (!ptrs.has(e.pointerId)) { if (e.pointerType === 'mouse') showTip(p[0], p[1]); return; }
  ptrs.set(e.pointerId, p);
  if (pinch && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    setFov(pinch.fov * pinch.d / Math.max(d, 1), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); return;
  }
  if (!drag) return;
  const dx = p[0] - drag.last[0], dy = p[1] - drag.last[1], k = degPerPx();
  if (Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) > 5) drag.moved = true;
  const now = performance.now(), dt = Math.max(1, now - drag.t);
  const dAz = -dx * k / Math.max(0.2, Math.cos(S.view.alt * Math.PI / 180)), dAlt = dy * k;
  S.view.az = (S.view.az + dAz + 360) % 360; S.view.alt = clampAlt(S.view.alt + dAlt);
  vel = { az: dAz / dt * 16.7, alt: dAlt / dt * 16.7 };
  drag.last = p; drag.t = now; S.dirty = true;
});
function endPtr(e) {
  const p = rel(e); ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (drag && !drag.moved && ptrs.size === 0) { select(pickAt(p[0], p[1], true) || pointAt(p[0], p[1])); vel = { az: 0, alt: 0 }; }
  if (drag && performance.now() - drag.t > 80) vel = { az: 0, alt: 0 };
  if (ptrs.size === 0) drag = null;
  canvas.style.cursor = 'grab';
}
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('pointerleave', () => { if (!ptrs.size) $('tip').hidden = true; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = rel(e); setFov(S.view.fov * Math.pow(1.0015, e.deltaY * (e.deltaMode ? 33 : 1)), x, y); }, { passive: false });
canvas.addEventListener('keydown', (e) => {
  const st = S.view.fov * 0.05; let used = true;
  if (e.key === 'ArrowLeft') S.view.az = (S.view.az - st + 360) % 360;
  else if (e.key === 'ArrowRight') S.view.az = (S.view.az + st) % 360;
  else if (e.key === 'ArrowUp') S.view.alt = clampAlt(S.view.alt + st);
  else if (e.key === 'ArrowDown') S.view.alt = clampAlt(S.view.alt - st);
  else if (e.key === '+' || e.key === '=') setFov(S.view.fov / 1.25);
  else if (e.key === '-' || e.key === '_') setFov(S.view.fov * 1.25);
  else if (e.key === 'Enter') { const cy = S.h / 2 - (S.view.shift || 0), o = pickAt(S.w / 2, cy, true) || pointAt(S.w / 2, cy); if (S.sel && S.sel === o) { if (!$('playPatch').hidden) location.href = $('playPatch').href; } else select(o); }
  else used = false;
  if (used) { e.preventDefault(); S.dirty = true; }
});
$('zin').onclick = () => setFov(S.view.fov / 1.5);
$('zout').onclick = () => setFov(S.view.fov * 1.5);
$('zreset').onclick = () => { S.view = { az: S.place.lat < 0 ? 0 : 180, alt: 40, fov: S.view.fov, shift: S.view.shift || 0 }; setFov(defaultFov()); };
const defaultFov = () => (S.w < 600 ? 100 : 90);

/* ---------- time controls ---------- */
const slider = $('tSlider');
slider.addEventListener('input', () => {
  if (!S.anchor) S.anchor = new Date(Math.floor(Date.now() / 60000) * 60000);
  S.offsetMin = +slider.value; recompute();
});
$('tDate').addEventListener('change', () => {
  const d = wallToDate($('tDate').value); if (!d) return;
  S.anchor = d; S.offsetMin = 0; slider.value = 0; recompute();
});
$('nowBtn').onclick = () => { S.anchor = null; S.offsetMin = 0; slider.value = 0; setPlaying(false); recompute(); announce('Showing the sky now'); };
function setPlaying(on) {
  if (on && set.motion) on = false;
  S.playing = on; const b = $('playBtn');
  b.dataset.playing = on; b.setAttribute('aria-pressed', on); b.setAttribute('aria-label', on ? 'Pause time' : 'Play time forward');
  if (on && !S.anchor) S.anchor = new Date(Date.now());
  lastTick = performance.now();
}
$('playBtn').onclick = () => setPlaying(!S.playing);
function segSelect(seg, pred) {
  const btns = [...seg.querySelectorAll('.seg-btn')]; let idx = 0;
  btns.forEach((b, k) => { const on = pred(b); b.setAttribute('aria-pressed', on); if (b.getAttribute('role') === 'tab') b.setAttribute('aria-selected', on); if (on) idx = k; });
  const th = seg.querySelector('.seg-thumb'), w = (seg.clientWidth - 6) / btns.length;
  th.style.width = w + 'px'; th.style.transform = `translateX(${idx * w}px)`;
}
$('speedSeg').querySelectorAll('.seg-btn').forEach(b => b.onclick = () => { S.rate = +b.dataset.rate; segSelect($('speedSeg'), x => x === b); });

/* ---------- switches ---------- */
function bindSwitch(id, key) { const b = $(id); b.onclick = () => { S.opt[key] = !S.opt[key]; b.setAttribute('aria-checked', S.opt[key]); S.dirty = true; }; }
bindSwitch('swGrid', 'grid'); bindSwitch('swNames', 'labels'); bindSwitch('swBelow', 'below');
// The whole Show row (label + switch, 44 px tall on phones) toggles its switch (Design review 2, item 3)
for (const id of ['swGrid', 'swNames', 'swBelow']) { const b = $(id), row = b.closest('.opt'); row?.classList.add('opt-tap'); row?.addEventListener('click', (e) => { if (!b.contains(e.target)) b.click(); }); }

/* ---------- popovers ---------- */
let openPop = null;
function showPop(pop, btn, alignLeft) {
  closePop(); const r = btn.getBoundingClientRect(); pop.hidden = false;
  pop.style.top = Math.min(r.bottom + 10, innerHeight - 160) + 'px';
  if (alignLeft) { pop.style.left = Math.max(12, Math.min(r.left, innerWidth - pop.offsetWidth - 12)) + 'px'; pop.style.right = 'auto'; pop.style.transformOrigin = 'top left'; }
  else { pop.style.right = Math.max(12, innerWidth - r.right) + 'px'; pop.style.left = 'auto'; }
  if (pop.id === 'placePop') segSelect($('placeTabs'), b => b.dataset.tab === curTab);
  requestAnimationFrame(() => pop.classList.add('open'));
  btn.setAttribute('aria-expanded', 'true'); openPop = { pop, btn };
  setTimeout(() => (pop.querySelector('[role=tab][aria-selected=true]') || pop.querySelector('button, input') || pop).focus(), 30);
}
function closePop(refocus) {
  if (!openPop) return; const { pop, btn } = openPop; pop.classList.remove('open'); btn.setAttribute('aria-expanded', 'false');
  setTimeout(() => { if (!pop.classList.contains('open')) pop.hidden = true; }, 220); openPop = null; if (refocus) btn.focus();
}
const toggler = (popId, btnId, left) => (e) => { e.stopPropagation(); openPop?.pop.id === popId ? closePop() : showPop($(popId), $(btnId), left); };
$('placeBtn').onclick = toggler('placePop', 'placeBtn', true);
$('clarityBtn').onclick = toggler('clarity', 'clarityBtn');
$('pagesBtn').onclick = toggler('pagesPop', 'pagesBtn');
document.addEventListener('click', (e) => { if (openPop && !openPop.pop.contains(e.target)) closePop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (openPop) closePop(true); else if ($('insp').classList.contains('open')) toggleInsp(false); } });
function toggleInsp(on) { $('insp').classList.toggle('open', on); $('infoBtn').setAttribute('aria-expanded', on); placeInsp(); if (on) $('inspClose').focus(); }
// Phone: the details sheet must never cover the dock's Now and Play keys. While it is open it fills the
// gap between the top bar and the dock (over the sky); when the dock is scrolled near the top it sits
// below the dock instead; otherwise (dock off screen) it is the usual bottom sheet.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
const MIN_SHEET = 220;
function placeInsp() {
  const el = $('insp'), st = el.style;
  if (innerWidth >= 700 || !el.classList.contains('open')) { st.top = st.bottom = st.maxHeight = st.height = ''; skyShift(null); return; }
  const d = $('dock').getBoundingClientRect(), bar = document.querySelector('.topbar')?.getBoundingClientRect();
  const top = Math.max(8, bar && bar.bottom > 0 ? bar.bottom + 8 : 8);
  let box = null, overSky = false;
  if (d.top - 8 - top >= MIN_SHEET) { // between the top bar and the dock: the lower half, so the sky stays in view above it
    const bot = Math.min(d.top, innerHeight) - 8, h = Math.max(MIN_SHEET, Math.min(innerHeight * 0.46, (bot - top) * 0.5));
    box = [Math.round(bot - h), bot]; overSky = true;
  }
  else if (d.bottom > 0 && innerHeight - 8 - (d.bottom + 8) >= MIN_SHEET) box = [d.bottom + 8, innerHeight - 8]; // below the dock
  else if (d.bottom > 0 && d.top < innerHeight) { // short screen: keep at least the Now / Play row clear
    const t = document.querySelector('.pl-dock .transport').getBoundingClientRect();
    if (t.top - 8 - top >= 120) box = [top, t.top - 8];
    else if (innerHeight - 8 - (t.bottom + 8) >= 120) box = [t.bottom + 8, innerHeight - 8];
  }
  if (!box) { st.top = st.bottom = st.maxHeight = st.height = ''; skyShift(null); return; } // dock off screen: plain bottom sheet
  st.top = box[0] + 'px'; st.bottom = 'auto'; st.height = 'auto'; st.maxHeight = (box[1] - box[0]) + 'px';
  skyShift(overSky ? box[0] : null);
}
// Move the sky's centre into the part of the canvas above the sheet (sheetTop: viewport px, or null for none).
function skyShift(sheetTop) {
  const c = canvas.getBoundingClientRect();
  let s = 0;
  if (sheetTop != null && sheetTop < c.bottom && sheetTop - c.top > 80) s = Math.round(c.height / 2 - (sheetTop - c.top) / 2);
  if (s !== (S.view.shift || 0)) { S.view.shift = s; S.dirty = true; }
}
addEventListener('scroll', () => { if ($('insp').classList.contains('open')) placeInsp(); }, { passive: true });
addEventListener('resize', placeInsp);
$('infoBtn').onclick = (e) => { e.stopPropagation(); toggleInsp(!$('insp').classList.contains('open')); };
$('inspClose').onclick = () => { toggleInsp(false); $('infoBtn').focus(); };

/* ---------- place popover: tabs, lists, my location, coordinates ---------- */
let curTab = DEFAULT_PLACE === S.place ? 'obs' : (NASA_CENTRES.includes(S.place) ? 'nasa' : 'obs');
function showTab(tab) {
  curTab = tab; segSelect($('placeTabs'), b => b.dataset.tab === tab);
  document.querySelectorAll('#placePop [data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab; });
}
$('placeTabs').querySelectorAll('.seg-btn').forEach(b => {
  b.onclick = (e) => { e.stopPropagation(); showTab(b.dataset.tab); };
  b.onkeydown = (e) => {
    const tabs = [...$('placeTabs').querySelectorAll('.seg-btn')], i = tabs.indexOf(b);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; showTab(n.dataset.tab); n.focus(); e.preventDefault(); }
  };
});
function fillList(ul, list) {
  ul.innerHTML = list.map(p => `<li><button class="pl-item" data-id="${p.id}"><span><b>${esc(p.name)}</b><small>${esc(p.country)}</small></span><span class="num">${fmtLat(p.lat)}<br>${fmtLon(p.lon)}</span></button></li>`).join('');
  ul.querySelectorAll('.pl-item').forEach(b => b.onclick = () => { setPlace(list.find(p => p.id === b.dataset.id)); closePop(true); });
}
fillList($('obsList'), OBSERVATORIES); fillList($('nasaList'), NASA_CENTRES);
$('geoBtn').onclick = (e) => {
  e.stopPropagation(); const st = $('geoState'); st.classList.remove('pl-err');
  if (!navigator.geolocation) { st.textContent = 'Location permission was blocked or unavailable. Type a place instead.'; st.classList.add('pl-err'); showTab('coord'); $('coordIn').focus(); return; }
  st.textContent = 'Asking your browser for your location…';
  navigator.geolocation.getCurrentPosition((pos) => {
    const lat = Math.round(pos.coords.latitude * 1000) / 1000, lon = Math.round(pos.coords.longitude * 1000) / 1000;
    let tz = null; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* none */ }
    st.textContent = ''; setPlace({ id: 'me', name: 'My location', country: '', lat, lon, elev: 0, tz }); closePop(true);
  }, () => {
    st.textContent = 'Location permission was blocked or unavailable. Type a place instead.'; st.classList.add('pl-err');
    showTab('coord'); $('coordIn').focus();
  }, { timeout: 8000, maximumAge: 600000, enableHighAccuracy: false });
};
$('coordForm').addEventListener('submit', (e) => {
  e.preventDefault(); const r = parsePlace($('coordIn').value), err = $('coordErr');
  if (r.error) { err.textContent = r.error; err.hidden = false; $('coordIn').focus(); return; }
  err.hidden = true; setPlace(r.place); closePop(true);
});

/* ---------- layout and the draw loop ---------- */
function layout() {
  const r = canvas.getBoundingClientRect(); S.dpr = Math.min(devicePixelRatio || 1, 2);
  if (r.width < 2 || r.height < 2) return;
  S.w = r.width; S.h = r.height;
  canvas.width = Math.round(S.w * S.dpr); canvas.height = Math.round(S.h * S.dpr);
  segSelect($('speedSeg'), b => +b.dataset.rate === S.rate); S.dirty = true;
}
let lastTick = performance.now(), lastMinute = -1;
function frame(now) {
  const dt = Math.min(100, now - lastTick); lastTick = now;
  if (S.playing && S.anchor) { S.anchor = new Date(S.anchor.getTime() + dt / 1000 * S.rate * 1000); recompute(); }
  else if (!S.anchor && !set.motion) { const m = Math.floor(Date.now() / 60000); if (m !== lastMinute) { lastMinute = m; recompute(); } } // "now": once a minute
  if (!drag && !pinch && (Math.abs(vel.az) > 0.01 || Math.abs(vel.alt) > 0.01)) {
    if (set.motion) vel = { az: 0, alt: 0 };
    else { S.view.az = (S.view.az + vel.az + 360) % 360; S.view.alt = clampAlt(S.view.alt + vel.alt); vel.az *= 0.88; vel.alt *= 0.88; S.dirty = true; }
  }
  if (S.dirty && S.w) {
    S.dirty = false;
    S.picks = draw(ctx, { avoid: avoidRects(), view: S.view, w: S.w, h: S.h, dpr: S.dpr, stars: S.stars, bodies: S.bodies, small: S.small, sel: S.sel, opt: S.opt, picks: S.picks });
  }
  requestAnimationFrame(frame);
}
function avoidRects() { // labels keep clear of the chips floating on the sky
  const c = canvas.getBoundingClientRect();
  return ['placeBar', 'dayChip', 'cap'].map($).filter(e => e && !e.hidden).map(e => { const r = e.getBoundingClientRect(); return [r.left - c.left - 4, r.top - c.top - 4, r.right - c.left + 4, r.bottom - c.top + 4]; });
}
function announce(msg) { $('live').textContent = msg; }

/* ---------- start ---------- */
applySettings();
initAir($('air'));
{ const ro = new ResizeObserver(() => layout()); ro.observe(canvas); ro.observe($('dock')); }
layout(); S.view.fov = defaultFov(); setFov(S.view.fov);
setPlace(S.place); showTab(curTab);
requestAnimationFrame(frame);
openFromQuery();
loadStars().then(() => recompute()).catch(() => { $('cap').textContent = 'The star list could not be loaded. The Sun, Moon and planets are still shown.'; });
window.__sky = { S, curTime }; // debugging hook (read-only use)
