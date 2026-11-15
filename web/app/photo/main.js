// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Your photo -> the sky (web/photo.html). The photo is decoded and solved in this browser tab only:
// nothing about it is sent anywhere. Solver: ./solve.js. Hints: lens (field of view), place + time
// (stars above the horizon, planets and the Moon via astronomy-engine).
import { prepareCatalogue, detectStars, solve, pixToSky, skyToPix, scaleDeg, fitTwo, checkTwo, starsInPhoto, summary } from './solve.js';
import { initShell, download } from '../archive/shell.js';
import { viewerUrl } from '../archive/logic.js';
import { formatRA, formatDec } from '../query.js';
import { isExpert, onExpert } from '../expert.js';
import { parsePlace } from '../planet/places.js';
import { observer, horMatrix, bodies } from '../planet/astro.js';
import { loadConstellations, constellation } from '../sky.js';

const $ = (id) => document.getElementById(id);
const MAX_SIDE = 1200; // the photo is solved at this size (long side)
const S = { bmp: null, bw: 0, bh: 0, w: 0, h: 0, stars: [], res: null, pick: null, mode: null, lu: [], luAt: null, planets: [], labels: [], name: '', busy: false };
const frame = () => new Promise(r => setTimeout(r, 0));
const status = (t) => { $('status').textContent = t || ''; };

// shell: search and picks go to the Viewer
initShell((q) => {
  const p = q.type === 'name' ? new URLSearchParams({ q: q.name, scene: 'viewer' }) : new URLSearchParams({ ra: q.ra.toFixed(5), dec: q.dec.toFixed(5), scene: 'viewer' });
  location.href = `index.html?${p}`;
});
history.replaceState(null, '', location.pathname + location.search.replace(/[?&]q=[^&]*/, '')); // keep the page's own address

let cat = null;
const catReady = fetch(new URL('../data/stars.json', import.meta.url)).then(r => r.json()).then(j => { cat = prepareCatalogue(j); });
loadConstellations().catch(() => {});

// ---- formatting ---------------------------------------------------------------------------------
const deg = (v, d = 1) => `${v.toFixed(d)}°`;
function simpleRaDec(ra, dec) {
  const h = ra / 15, hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return `RA ${mm === 60 ? hh + 1 : hh}h ${String(mm % 60).padStart(2, '0')}m, Dec ${dec < 0 ? '−' : '+'}${Math.abs(dec).toFixed(1)}°`;
}
const raDecText = (ra, dec) => (isExpert() ? `${formatRA(ra)} ${formatDec(dec)} (${ra.toFixed(4)}°, ${dec.toFixed(4)}°)` : simpleRaDec(ra, dec));
const conName = (ra, dec) => { try { return constellation(ra, dec)?.name || ''; } catch { return ''; } };

// ---- hints --------------------------------------------------------------------------------------
function hints() {
  const out = { fov: null, place: null, date: null, err: '' };
  const f = parseFloat($('focal').value);
  if (f > 0) out.fov = 2 * Math.atan(parseFloat($('sensor').value) / (2 * f)) * 180 / Math.PI;
  const pt = $('place').value.trim(), wt = $('when').value;
  if (pt) { const r = parsePlace(pt); if (r.error) out.err = r.error; else out.place = r.place; }
  if (wt) { const d = new Date(wt); if (!isNaN(d)) out.date = d; }
  if (out.place && !out.date) out.err ||= 'Add the date and time too, for the planets and the Moon.';
  if (out.date && !out.place && !pt) out.err ||= 'Add where it was taken too, for the planets and the Moon.';
  return out;
}
const hasSky = (h) => !!(h.place && h.date);
// a catalogue filter: stars above (or within 3 deg of) the horizon for that place and time
function horizonKeep(h) {
  const M = horMatrix(h.date, observer(h.place.lat, h.place.lon, h.place.elev || 0))[2], lim = Math.sin(-3 * Math.PI / 180);
  return (i) => M[0] * cat.v[3 * i] + M[1] * cat.v[3 * i + 1] + M[2] * cat.v[3 * i + 2] > lim;
}

// ---- loading a photo ----------------------------------------------------------------------------
async function loadFile(file, name) {
  if (!file || !/^image\/(jpeg|png)$/.test(file.type) && !/\.(jpe?g|png)$/i.test(name || file.name || '')) { fail('That file isn’t a JPG or PNG photo.'); return; }
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { fail('This photo could not be read. Try a JPG or PNG.'); return; }
  S.bmp = bmp; S.bw = bmp.width; S.bh = bmp.height; S.name = name || file.name || 'photo';
  const k = Math.min(1, MAX_SIDE / Math.max(S.bw, S.bh));
  S.w = Math.max(1, Math.round(S.bw * k)); S.h = Math.max(1, Math.round(S.bh * k));
  const c = document.createElement('canvas'); c.width = S.w; c.height = S.h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, S.w, S.h);
  const px = g.getImageData(0, 0, S.w, S.h).data, lum = new Float32Array(S.w * S.h);
  for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2];
  S.lum = lum;
  Object.assign(S, { res: null, pick: null, mode: null, lu: [], luAt: null, planets: [], labels: [] });
  $('drop').hidden = true; $('cv').classList.add('on'); plot.classList.add('has'); plot.style.setProperty('--ar', `${S.w} / ${S.h}`); $('phTitle').textContent = S.name;
  $('luStart').disabled = false; $('again').disabled = false;
  endLineup();
  await run();
}
async function loadSample() {
  try {
    const r = await fetch(new URL('../../data/photo-test.png', import.meta.url));
    await loadFile(new File([await r.blob()], 'Test image (Orion, drawn from the star catalogue)', { type: 'image/png' }), 'Test image: Orion, drawn by the computer from the star catalogue');
  } catch { fail('The test image could not be loaded.'); }
}

// ---- solving ------------------------------------------------------------------------------------
async function run() {
  if (!S.lum || S.busy) return;
  S.busy = true; $('again').disabled = true;
  try {
    setResult('busy');
    status('Finding stars…'); await frame(); await catReady;
    const { stars } = detectStars(S.lum, S.w, S.h);
    S.stars = stars;
    $('fileTxt').textContent = `${S.bw} × ${S.bh} pixels · ${stars.length >= 200 ? '200+' : stars.length} star-like dots found. Read on this device only.`;
    const h = hints();
    $('hintErr').textContent = h.err; $('hintErr').hidden = !h.err;
    const keep = hasSky(h) ? horizonKeep(h) : null;
    const prog = async (t) => { status(t); await frame(); };
    let res = await solve(cat, stars, S.w, S.h, { fov: h.fov, keep, onProgress: prog });
    let note = '';
    if (!res.ok && keep) { res = await solve(cat, stars, S.w, S.h, { fov: h.fov, onProgress: prog }); if (res.ok) note = 'The place and time hint didn’t fit this part of the sky, so it was solved without it.'; }
    status('');
    if (res.ok) { S.res = { ...res, byHand: false, note }; afterSolve(h); }
    else { S.res = null; S.lastFail = res; setResult('fail'); draw(); }
  } finally { S.busy = false; $('again').disabled = !S.lum; }
}

function afterSolve(h = hints()) {
  const r = S.res, sol = r.sol;
  const wide = Math.max(r.fovW, r.fovH);
  S.labels = starsInPhoto(cat, sol, S.w, S.h, wide > 40 ? 4.5 : wide > 15 ? 5.5 : 7, 300);
  S.planets = [];
  if (hasSky(h)) {
    try {
      for (const b of bodies(h.date, observer(h.place.lat, h.place.lon, h.place.elev || 0))) {
        if (b.key === 'Sun') continue;
        const p = skyToPix(sol, b.ra, b.dec);
        if (p && p.x >= 0 && p.y >= 0 && p.x < S.w && p.y < S.h) S.planets.push({ ...b, x: p.x, y: p.y });
      }
    } catch { /* no planets */ }
  }
  S.pick = { x: S.w / 2, y: S.h / 2, centre: true };
  setResult(r.ok ? 'ok' : 'unconfirmed');
  draw();
}

// ---- result panel -------------------------------------------------------------------------------
function setResult(kind) {
  const el = $('result'), r = S.res;
  el.dataset.solved = kind === 'ok' ? 'true' : kind === 'busy' ? 'busy' : kind === 'none' ? 'false' : 'fail';
  const show = kind === 'ok' || kind === 'unconfirmed';
  $('resDl').hidden = !show; $('goViewer').hidden = kind !== 'ok'; $('pickTxt').hidden = kind !== 'ok';
  $('csv').hidden = kind !== 'ok'; $('key').hidden = !show; $('phTag').hidden = !show;
  if (kind === 'busy') { $('resTxt').textContent = 'Looking for star patterns…'; return; }
  if (kind === 'none') { $('resTxt').textContent = 'Drop in a photo to begin.'; return; }
  if (kind === 'fail') {
    const f = S.lastFail || {};
    $('resTxt').innerHTML = f.reason === 'few-stars'
      ? `<b>Too few stars to work with.</b> Only ${f.found || 0} star-like dots were found; it needs at least 6. A longer exposure or a darker sky helps, or line it up by hand below.`
      : `<b>No confident match.</b> ${f.tried ? `${f.tried.toLocaleString('en')} possible star patterns were checked, but` : 'So far'} none lined up with enough other stars to rule out chance, so it won’t guess. Add the lens hint, or line it up by hand below.`;
    return;
  }
  const c = r.centre, con = conName(c.ra, c.dec);
  const extra = r.matched - (r.byHand ? 2 : 4);
  if (kind === 'ok') {
    $('resTxt').innerHTML = r.byHand
      ? `<b>Lined up by hand, and checked.</b> Besides your two stars, ${extra} more stars in your photo land on catalogue stars.${r.note ? ' ' + r.note : ''}`
      : `<b>Found it.</b> ${r.matched} stars in your photo line up with the catalogue${isExpert() ? '' : ' (far more than chance could give)'}${con ? `. The photo is centred in ${con}` : ''}.${r.note ? ' ' + r.note : ''}`;
  } else {
    $('resTxt').innerHTML = `<b>Not confirmed.</b> Only ${Math.max(0, extra)} other star${extra === 1 ? '' : 's'} line up, so the two names may not match the stars you clicked. Try two other bright stars, well apart.`;
  }
  $('rCentre').textContent = `${raDecText(c.ra, c.dec)}${con ? ` · ${con}` : ''}`;
  $('rFov').textContent = `${deg(r.fovW)} × ${deg(r.fovH)}`;
  const k = S.bw / S.w, arcmin = (px) => (px * scaleDeg(r.sol) * 60).toFixed(1);
  $('rMatch').textContent = `${r.matched} of ${r.used} stars matched (needed ${r.need}; chance ≈ ${r.chance.toFixed(2)}) · RMS ${(r.rmsPx * k).toFixed(1)} px (${arcmin(r.rmsPx)}′) · tolerance ${(r.tolPx * k).toFixed(1)} px`;
  $('rUp').textContent = `Top of photo points ${deg(r.up)} east of north${r.mirrored ? ' (mirrored image)' : ''} · ${(scaleDeg(r.sol) / k * 3600).toFixed(1)}″ per pixel`;
  updatePick();
}

function updatePick() {
  if (!S.res?.ok || !S.pick) return;
  const p = pixToSky(S.res.sol, S.pick.x, S.pick.y), con = conName(p.ra, p.dec);
  $('pickTxt').innerHTML = `${S.pick.centre ? 'Photo centre' : 'Your point'}: <span class="num">${raDecText(p.ra, p.dec)}</span>${con ? ` in ${con}` : ''}. ${S.pick.centre ? 'Click the photo to pick another point.' : 'Click again to move it.'}`;
  $('goViewer').href = viewerUrl(p.ra, p.dec);
}

function fail(msg) { $('resTxt').innerHTML = `<b>${msg}</b>`; $('result').dataset.solved = 'fail'; status(''); }

// ---- drawing ------------------------------------------------------------------------------------
const cv = $('cv'), plot = $('plot');
function view() {
  const cw = plot.clientWidth, ch = plot.clientHeight, f = Math.min(cw / S.w, ch / S.h);
  return { cw, ch, f, ox: (cw - S.w * f) / 2, oy: (ch - S.h * f) / 2 };
}
function draw() {
  if (!S.bmp) return;
  const dpr = Math.min(2, devicePixelRatio || 1), v = view();
  cv.width = Math.round(v.cw * dpr); cv.height = Math.round(v.ch * dpr);
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0b0907'; g.fillRect(0, 0, v.cw, v.ch);
  g.drawImage(S.bmp, v.ox, v.oy, S.w * v.f, S.h * v.f);
  const X = (x) => v.ox + x * v.f, Y = (y) => v.oy + y * v.f;
  const text = (t, x, y, col) => { g.font = '600 12px "Instrument Sans", system-ui, sans-serif'; g.lineWidth = 3.5; g.strokeStyle = 'rgba(8,6,4,.92)'; g.strokeText(t, x, y); g.fillStyle = col; g.fillText(t, x, y); };
  const r = S.res, R = Math.max(4.5, Math.min(8, 8 * Math.sqrt(v.f)));
  if (S.mode === 'lu') { // help the click: small ticks on the stars found
    g.strokeStyle = 'rgba(127,209,255,.7)'; g.lineWidth = 1;
    for (const s of S.stars.slice(0, 80)) { g.beginPath(); g.arc(X(s.x), Y(s.y), 5, 0, 7); g.stroke(); }
    S.lu.forEach((p, k) => { g.strokeStyle = '#FFD84A'; g.lineWidth = 2; g.beginPath(); g.arc(X(p.x), Y(p.y), 10, 0, 7); g.stroke(); text(`${k + 1}. ${starLabel(p.i)}`, X(p.x) + 13, Y(p.y) - 8, '#FFD84A'); });
    if (S.luAt) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(X(S.luAt.x), Y(S.luAt.y), 11, 0, 7); g.stroke(); }
  }
  if (r) {
    const matched = new Set(r.pairs.map(p => p.star));
    g.lineWidth = 1;
    for (const s of S.labels) if (!matched.has(s.i)) { g.strokeStyle = 'rgba(237,229,218,.55)'; g.beginPath(); g.arc(X(s.x), Y(s.y), R - 2, 0, 7); g.stroke(); }
    g.lineWidth = 2; g.strokeStyle = r.ok ? '#FFD84A' : 'rgba(255,216,74,.5)';
    for (const p of r.pairs) { g.beginPath(); g.arc(X(p.x), Y(p.y), R, 0, 7); g.stroke(); }
    for (const s of S.labels) if (s.name) text(s.name, X(s.x) + 10, Y(s.y) - 7, '#FFF6E8');
    for (const b of S.planets) {
      const x = X(b.x), y = Y(b.y);
      g.strokeStyle = '#7FD1FF'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 9, y); g.lineTo(x, y + 9); g.lineTo(x - 9, y); g.closePath(); g.stroke();
      text(b.name, x + 12, y + 4, '#7FD1FF');
    }
    if (r.ok && S.pick) {
      const x = X(S.pick.x), y = Y(S.pick.y);
      g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, 12, 0, 7); g.moveTo(x - 20, y); g.lineTo(x - 6, y); g.moveTo(x + 6, y); g.lineTo(x + 20, y); g.moveTo(x, y - 20); g.lineTo(x, y - 6); g.moveTo(x, y + 6); g.lineTo(x, y + 20); g.stroke();
    }
  }
  $('keyPl').hidden = !S.planets.length;
}
new ResizeObserver(() => draw()).observe(plot);

function toPhoto(e) {
  const b = cv.getBoundingClientRect(), v = view();
  return { x: (e.clientX - b.left - v.ox) / v.f, y: (e.clientY - b.top - v.oy) / v.f };
}
cv.addEventListener('click', (e) => {
  if (!S.bmp) return;
  const p = toPhoto(e);
  if (p.x < 0 || p.y < 0 || p.x >= S.w || p.y >= S.h) return;
  if (S.mode === 'lu') { // snap to the nearest star found (within about 18 screen pixels)
    const lim = 18 / view().f;
    let best = null, bd = lim;
    for (const s of S.stars) { const d = Math.hypot(s.x - p.x, s.y - p.y); if (d < bd) { bd = d; best = s; } }
    S.luAt = best ? { x: best.x, y: best.y } : p;
    $('luPick').hidden = false; $('luLabel').textContent = `Which star is number ${S.lu.length + 1}?`; $('luName').focus();
    draw(); return;
  }
  if (S.res?.ok) { S.pick = { ...p, centre: false }; updatePick(); draw(); }
});

// ---- "Help me line it up" ----------------------------------------------------------------------
const starLabel = (i) => cat.names[cat.hip[i]] || `HIP ${cat.hip[i]}`;
function fillNames() {
  const h = hints(), keep = hasSky(h) ? horizonKeep(h) : null, up = [], down = [];
  for (let i = 0; i < cat.n; i++) if (cat.names[cat.hip[i]]) (keep && !keep(i) ? down : up).push(i);
  const opt = (i) => `<option value="${i}">${starLabel(i)} (magnitude ${cat.mag[i].toFixed(1)})</option>`;
  $('luName').innerHTML = keep
    ? `<optgroup label="Up at that place and time">${up.map(opt).join('')}</optgroup><optgroup label="Below the horizon then">${down.map(opt).join('')}</optgroup>`
    : up.map(opt).join('');
}
function endLineup() {
  S.mode = null; S.lu = []; S.luAt = null;
  $('luPick').hidden = true; $('luCancel').hidden = true; $('luStart').hidden = false;
  $('luTxt').textContent = 'If it can’t find the stars by itself: click two stars you know on your photo and pick their names.';
}
$('luStart').onclick = async () => {
  await catReady;
  fillNames();
  S.mode = 'lu'; S.lu = []; S.luAt = null;
  $('luStart').hidden = true; $('luCancel').hidden = false;
  $('luTxt').textContent = 'Step 1 of 2: click a bright star you know on the photo. Blue circles show the stars found.';
  draw();
};
$('luCancel').onclick = () => { endLineup(); draw(); };
$('luOk').onclick = () => {
  if (!S.luAt) return;
  S.lu.push({ ...S.luAt, i: +$('luName').value }); S.luAt = null; $('luPick').hidden = true;
  if (S.lu.length < 2) { $('luTxt').textContent = 'Step 2 of 2: click a second star, well away from the first.'; draw(); return; }
  const [a, b] = S.lu, sol = fitTwo(cat, a, a.i, b, b.i, S.w, S.h);
  endLineup();
  if (!sol) { fail('Pick two different stars, well apart.'); draw(); return; }
  const chk = checkTwo(cat, sol, S.stars, S.w, S.h);
  if (chk) {
    S.res = { ...chk, byHand: true, note: '' };
    if (!chk.ok) S.res.ok = false;
  } else {
    S.res = { sol, pairs: [], matched: 2, used: 0, need: 8, chance: 0, ok: false, byHand: true, rmsPx: 0, tolPx: 0, ...summaryOf(sol) };
  }
  afterSolve();
};
const summaryOf = (sol) => summary(sol, S.w, S.h);

// ---- inputs -------------------------------------------------------------------------------------
$('file').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; });
for (const id of ['sample', 'sample2']) $(id).onclick = () => loadSample();
$('again').onclick = () => run();
const stage = document.querySelector('.ph-stage');
stage.addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
stage.addEventListener('dragleave', () => $('drop').classList.remove('over'));
stage.addEventListener('drop', (e) => { e.preventDefault(); $('drop').classList.remove('over'); const f = e.dataTransfer?.files?.[0]; if (f) loadFile(f); });
$('csv').onclick = () => {
  const r = S.res; if (!r?.ok) return;
  const k = S.bw / S.w, rows = ['hip,name,ra_deg,dec_deg,vmag,x_px,y_px'];
  for (const p of r.pairs) rows.push([cat.hip[p.star], `"${cat.names[cat.hip[p.star]] || ''}"`, cat.ra[p.star].toFixed(5), cat.dec[p.star].toFixed(5), cat.mag[p.star].toFixed(2), (p.x * k).toFixed(1), (p.y * k).toFixed(1)].join(','));
  download('photo-matched-stars.csv', rows.join('\n') + '\n');
};
onExpert(() => { if (S.res) setResult(S.res.ok ? 'ok' : 'unconfirmed'); });
if (new URLSearchParams(location.search).has('sample')) loadSample(); // page check / demo link
