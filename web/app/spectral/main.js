// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Spectral Explorer page: a quick-look spectrum built on the fly from individual SPHEREx images.
// For each image: small cutout around the star (IRSA), aperture sum minus background ring,
// wavelength at that pixel from the image's spectral WCS (-TAB), one dot on the chart.

import { listImages, fetchCutout, maskBadPixels } from '../../core/irsa.js';
import { wavelengthAt } from '../../core/wave.js';
import { propagate } from '../../core/motion.js';
import { DEFAULT_BANDS, DETECTORS, BAND_NOTE, bandName } from '../bands.js';
import { seasonsOf, seasonIndex, mjdToUtc, bandAt, targetViewerUrl } from '../archive/logic.js';
import { IRSA } from '../../core/irsa.js';
import {
  X_RANGE, FEATURES, APERTURES, CUTOUT_DEG, PIXEL_ARCSEC, pickImages, aperturePhotometry, pixelSolidAngle, toMilliJy,
  apertureFlagged, whyNoPhotometry, niceTicks, logTicks, yRange, fmtValue, pointsToCSV, lightCheck,
} from './logic.js';
import { pickSource, pickSaved, BLEND_RADIUS, GROUPS } from '../lightcurve/logic.js';
import { gaiaCone } from '../../core/resolve.js';
import { prebakedFetch } from '../../core/prebaked.js';
import { isExpert, onExpert } from '../expert.js'; // Simple / Expert (Master item 5)
import { base, initShell, resolve, listPosition, targetLine, motionHtml, download, slug, esc, cutoutCenter } from '../archive/shell.js';

const $ = (id) => document.getElementById(id);
const SHAPES = ['circle', 'square', 'triangle', 'diamond'];
const SHORT = { 'd-starlight': 'Star', 'd-coolstars': 'Cool', 'd-dust': 'Dust', 'd-waterice': 'Water', 'd-co2ice': 'CO₂', 'd-browndwarfs': 'BD' };
const S = {
  target: null, images: [], seasons: [], cuts: [], points: [], queue: [], queued: new Set(), done: 0, failed: 0, total: 0,
  aperture: APERTURES[1], season: 'all', log: false, ctrl: null, running: 0, hover: null,
  inflight: new Set(), lost: [], lastArrive: 0, busy: 0, listed: false, checkKey: '', otherDets: new Map(), otherSrc: {},
};
const FRESH = () => ({ inflight: new Set(), lost: [], busy: 0, listed: false, checkKey: '', otherDets: new Map(), otherSrc: {} });
const OTHER = '#8F857A'; // grey: a dot whose light is another source's (checkLight)
const isOther = (p) => S.otherDets.has(p.detector);
let tables = null;
const tablesReady = fetch('core/data/spectral_wcs.json').then(r => r.json()).then(t => { tables = t; }).catch(() => {});

// ---- data -----------------------------------------------------------------------------------
async function load(q) {
  S.ctrl?.abort();
  const ctrl = S.ctrl = new AbortController();
  Object.assign(S, { images: [], seasons: [], cuts: [], points: [], queue: [], queued: new Set(), done: 0, failed: 0, total: 0, season: 'all', hover: null, running: 0, ...FRESH() });
  $('more').disabled = true; $('csv').disabled = true;
  $('downNote').hidden = true; $('lightNote').hidden = true;
  setStatus('Finding the star…'); progress(); renderSeasons(); draw();
  try {
    const t = await resolve(q, ctrl.signal);
    if (ctrl.signal.aborted) return;
    S.target = t;
    watch(ctrl);
    const tl = targetLine(t);
    $('tName').textContent = tl.name; $('tCoords').textContent = tl.coords;
    // motion and "Position now" as separate parts, so a phone can put each on its own line (pages.css .sp-tl)
    $('tPm').innerHTML = motionHtml(t, tl);
    $('tName').parentElement.classList.add('sp-tl');
    document.title = `${tl.name} · Spectral Explorer · Star Shift`;
    setStatus('Asking IRSA which SPHEREx images cover this star…');
    const p = listPosition(t);
    const [ims] = await Promise.all([listImages(p.ra, p.dec, { base, signal: ctrl.signal }), tablesReady]);
    if (ctrl.signal.aborted) return;
    S.listed = true; S.lastArrive = Date.now();
    if (!ims.length) { setStatus('The archive has no SPHEREx images of this spot yet.'); return; }
    if (!tables) { setStatus('Could not load the wavelength tables (core/data/spectral_wcs.json).'); return; }
    S.images = ims;
    S.seasons = seasonsOf(ims.map(im => im.mjdStart));
    renderSeasons();
    enqueue(pickImages(ims, perDet()));
  } catch (e) {
    if (e.name === 'AbortError' || ctrl.signal.aborted) return; // a newer search, or the watchdog (its own message)
    if (e.notFound || !S.target) { // no star: drop the previous star's heading, motion line and tab title (Full function test)
      S.target = null; $('tName').textContent = String(q?.name || q?.text || q || '').trim() || 'No star'; $('tCoords').textContent = ''; $('tPm').innerHTML = ''; document.title = 'Spectral Explorer · Star Shift';
      setStatus(e.notFound ? e.message : `Could not find the star: ${e.message}`); return; }
    setStatus(''); archiveDown(ctrl, true);
  }
}

// Live stars (judging panel a10, the Spot rule): when IRSA sends nothing new for STALL_MS, or answers
// "busy" BUSY_503 times in a row, stop, say so, keep the dots already measured, and offer Retry.
// The five demo targets answer from web/prebaked/ at once.
const STALL_MS = 18000, STALL_LIST_MS = 60000, BUSY_503 = 30; // the image list itself can take 20-25 s on a busy night
function watch(ctrl) {
  const t0 = S.lastArrive = Date.now();
  const h = setInterval(() => {
    if (ctrl !== S.ctrl || ctrl.signal.aborted) return clearInterval(h);
    const now = Date.now();
    if (S.listed && !S.running && !S.queue.length) { S.lastArrive = now; return; } // idle: nothing asked
    if (now - S.lastArrive >= (S.listed ? STALL_MS : STALL_LIST_MS) || (S.busy >= BUSY_503 && now - t0 >= STALL_MS)) { clearInterval(h); archiveDown(ctrl); }
  }, 500);
}
function lose(im) { S.failed++; S.queued.delete(im.uri); S.lost.push(im); } // "Retry" or "Measure more" may ask again
function archiveDown(ctrl, quick = false) {
  const pending = [...S.inflight, ...S.queue];
  ctrl.abort();
  S.queue = []; S.inflight.clear(); S.running = 0;
  for (const im of pending) { lose(im); S.done++; }
  const got = S.points.length, asked = S.total, came = S.done - S.failed;
  $('downTxt').textContent = (!S.listed ? (quick ? 'It did not send the list of images for this star.' : `IRSA sent nothing for ${STALL_MS / 1000} seconds.`)
    : !came ? `None of the ${asked} images came in.`
    : `${came} of ${asked} images came in, then IRSA ${quick ? 'stopped answering' : 'went quiet'}; the ${got} dot${got === 1 ? '' : 's'} so far stay.`) + ' It is often busy; Retry asks again.';
  $('downNote').hidden = false;
  setStatus(''); progress(); draw();
}
$('retry').onclick = () => {
  $('downNote').hidden = true;
  if (!S.listed) return load(currentQ);
  const again = S.lost.splice(0);
  S.failed -= again.length; S.done -= again.length; S.total -= again.length; S.busy = 0;
  enqueue(again);
};

// Whose light are the dots? (lightCheck: the viewer's a3 rule.) A group whose light centre sits on
// another source gets one plain line naming it (Gaia through our relay; offline, the Gaia DR3 cone the
// Proof page saved in proof.json). Only when a run has finished; the same cutouts are never re-judged.
async function checkLight() {
  const t = S.target, cuts = S.cuts;
  const key = `${t?.ra},${t?.dec}:${cuts.length}`;
  if (!t || key === S.checkKey) return;
  S.checkKey = key;
  const lines = [], groups = lightCheck(cuts, t);
  // Panel round 2, A3: every dot of a group whose light is not the target's is drawn grey and hollow
  // ("light from another source"); the same rule as the viewer's "Not detected here" row.
  S.otherDets = new Map();
  for (const g of groups) if (g.detect.state === 'offset' && g.sky) for (const d of GROUPS.find(q => q.id === g.id).dets) S.otherDets.set(d, g.id);
  renderKey(); draw();
  for (const g of groups) {
    if (g.detect.state !== 'offset' || !g.sky) continue;
    let src = null;
    if (t.presetKey) src = pickSaved(await savedNeighbours(t.name), g.sky); // demo targets: no network needed
    if (!src) {
      const [ra, dec] = g.sky.light;
      src = await gaiaCone(ra, dec, BLEND_RADIUS, { endpoint: `${location.origin}/gaia/tap/sync`, top: 10, signal: AbortSignal.timeout(15000) })
        .then(rows => pickSource(rows, g.sky)).catch(() => null) || pickSaved(await savedNeighbours(t.name), g.sky);
    }
    if (S.checkKey !== key) return; // another star since
    S.otherSrc[g.id] = src;
    const where = g.id === 'short' ? 'Below 3.8 µm' : 'From 3.8 to 5 µm';
    const who = src ? `a background star (Gaia G ${src.g.toFixed(1)}, ${src.sepArcsec.toFixed(1)}″ away)` : `another source, centred ${g.sky.offArcsec.toFixed(1)}″ away`;
    lines.push(`${where} the light here is ${who}, not ${esc(t.name || 'this star')}: those dots are grey and hollow.` +
      `<span class="x-only"> Light centre ${g.sky.offArcsec.toFixed(1)}″ (${(g.detect.offPx).toFixed(1)} px) from the predicted position, median of ${g.detect.hits} of ${g.detect.n} clean images${src?.id ? `; ${esc(src.id)}` : ''}.</span>`);
  }
  if (S.checkKey !== key) return;
  // a background star close enough to sit inside the measuring circle blends with the target at EVERY wavelength,
  // so the coloured (long-band) dots are the target plus some of that star's light (Idea Generation, Sun 15 Nov)
  const rAp = S.aperture?.rAp, near = rAp && Object.values(S.otherSrc).find(s => s && s.sepArcsec <= rAp * PIXEL_ARCSEC);
  if (near) lines.push(`The coloured dots are ${esc(t.name || 'this star')} plus some light from that background star, which sits inside the ${(rAp * PIXEL_ARCSEC).toFixed(0)}″ measuring circle at every wavelength (blended).`);
  $('lightNote').innerHTML = lines.join('<br>');
  $('lightNote').hidden = !lines.length;
}
let proofP = null;
async function savedNeighbours(name) { // as lightcurve/index.js
  proofP ||= fetch(new URL('../../data/proof.json', import.meta.url)).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const t = (await proofP)?.targets?.find(q => q.name === name || q.label === name);
  return t?.extra?.neighbours || [];
}
// IRSA's "busy" answers, counted for the watchdog (fetchCutout retries them itself).
const counted = (u, o) => prebakedFetch(u, o).then((r) => { if ([429, 502, 503].includes(r.status)) S.busy++; return r; });

function enqueue(list) {
  const add = list.filter(im => !S.queued.has(im.uri));
  if (add.length && S.ctrl.signal.aborted) { $('downNote').hidden = true; S.ctrl = new AbortController(); watch(S.ctrl); } // after "isn't answering"
  for (const im of add) { S.queued.add(im.uri); S.queue.push(im); }
  S.total += add.length;
  progress();
  pump();
}

function pump() {
  const ctrl = S.ctrl;
  while (S.running < 8 && S.queue.length) {
    const im = S.queue.shift();
    S.running++; S.inflight.add(im);
    measureImage(im, ctrl.signal).then((cut) => {
      if (ctrl.signal.aborted) return;
      S.lastArrive = Date.now(); S.busy = 0;
      S.cuts.push(cut);
      const p = pointFrom(cut);
      if (p) S.points.push(p); else cut.missing = true;
    }).catch((e) => {
      if (ctrl.signal.aborted || e.name === 'AbortError') return;
      if (!im.retried) { S.queue.push({ ...im, retried: true }); S.total++; return; }
      lose(im);
    }).finally(() => {
      if (ctrl.signal.aborted) return;
      S.inflight.delete(im);
      S.running--; S.done++;
      progress(); scheduleDraw(); pump();
      if (!S.running && !S.queue.length) runDone(ctrl);
    });
  }
}

// A run finished: most images failed = the archive is down (fast errors, e.g. no connection);
// otherwise check whose light the dots are (WISE 0855's short wavelengths: a background star).
function runDone(ctrl) {
  if (S.lost.length && S.lost.length >= S.total / 2) return archiveDown(ctrl, true);
  checkLight();
}

// Download a small cutout and keep what the measurement needs (so changing the aperture is instant).
async function measureImage(im, signal) {
  const c0 = cutoutCenter(S.target, im.mjdStart);
  const raw = await fetchCutout(im.uri, c0.ra, c0.dec, CUTOUT_DEG, { base, signal, fetchFn: counted });
  const c = maskBadPixels(raw);
  const pos = (S.target.pmra || S.target.pmdec) ? propagate(S.target, c.mjd) : S.target;
  const [x, y] = c.wcs.worldToPix(pos.ra, pos.dec);
  const tab = tables[String(c.detector)];
  const wl = tab ? wavelengthAt(c.header, tab, x, y) : null;
  return {
    uri: im.uri, obsid: c.obsid || im.obsid, mjd: c.mjd ?? im.mjdStart, detector: c.detector, x, y, wcs: c.wcs,
    image: c.image, flags: raw.flags?.data ?? null, flagNames: raw.flagNames, pixSr: pixelSolidAngle(c.wcs, x, y),
    um: wl?.wavelength ?? null, bw: wl?.bandwidth ?? null,
  };
}

function pointFrom(cut) {
  cut.why = null;
  if (!Number.isFinite(cut.um)) { cut.why = 'wave'; return null; }
  const a = S.aperture;
  const ph = aperturePhotometry(cut.image, cut.x, cut.y, a);
  if (!ph) { cut.why = whyNoPhotometry(cut.image, cut.x, cut.y, a) || 'masked'; return null; }
  const fl = apertureFlagged(cut.flags, cut.flagNames, ph.idx);
  const t = mjdToUtc(cut.mjd);
  return {
    uri: cut.uri, obsid: cut.obsid, mjd: cut.mjd, iso: t.iso, date: t.date, time: t.time, detector: cut.detector,
    um: cut.um, bw: cut.bw, band: bandAt(cut.um)?.name ?? null, color: bandAt(cut.um)?.color ?? '#B5A898',
    season: seasonIndex(cut.mjd, S.seasons), mJy: toMilliJy(ph.net, cut.pixSr), errMJy: toMilliJy(ph.err, cut.pixSr),
    net: ph.net, bg: ph.bg, nAp: ph.nAp, nApValid: ph.nApValid, flagged: fl.flagged, kinds: fl.kinds, irsaUrl: `${IRSA}/${cut.uri}`,
  };
}

function remeasure() {
  S.points = [];
  for (const c of S.cuts) { const p = pointFrom(c); c.missing = !p; if (p) S.points.push(p); }
  renderKey();
  progress(); draw();
}

// ---- side panel ---------------------------------------------------------------------------------
function setStatus(t) { $('status').textContent = t; }

function progress() {
  const pct = S.total ? Math.round((100 * S.done) / S.total) : 0;
  $('progBar').style.width = pct + '%';
  const missing = S.cuts.filter(c => c.missing);
  const why = { masked: 'centre pixels have no usable data (typical of a saturated star)', edge: 'off the cutout', background: 'background ring empty', wave: 'no wavelength table' };
  const reasons = Object.entries(missing.reduce((o, c) => ((o[c.why] = (o[c.why] || 0) + 1), o), {})).map(([k, n]) => `${n} ${why[k] ?? k}`).join(', ');
  $('progTxt').textContent = S.total
    ? `${S.done} of ${S.total} images measured · ${S.points.length} dots` + (missing.length ? ` · not measurable: ${reasons}` : '') + (S.failed ? ` · ${S.failed} failed` : '') + ` · ${S.images.length.toLocaleString()} in the archive`
    : 'Waiting for the image list…';
  setStatus(S.total && S.done < S.total ? `Measuring ${S.total - S.done} more image${S.total - S.done === 1 ? '' : 's'}…` : S.total ? '' : $('status').textContent);
  $('more').disabled = !S.images.length || S.queued.size >= S.images.length;
  $('csv').disabled = !S.points.length;
  $('caption').innerHTML = caption();
  renderKey();
  updateFill();
}

function caption() {
  const a = S.aperture;
  const simple = `<span class="s-only">Each dot is the light in the measuring circle in one image: the light within ${(a.rAp * PIXEL_ARCSEC).toFixed(0)}″ of the star, with the sky glow around it taken off. A quick look, not calibrated: dots from different images can disagree a little.</span>`;
  return `<span class="tag comp">COMPUTED</span>${simple}<span class="x-only">Each dot: the sum of the pixel values (MJy/sr) whose centres lie within ${a.rAp} px (${(a.rAp * PIXEL_ARCSEC).toFixed(1)}″) of the star's position on that image's date, minus the median of a ${a.rIn}–${a.rOut} px background ring, times each pixel's solid angle (giving mJy). ` +
    `Pixels the archive marks as bad are left out and the sum is scaled up for them. Not done: no aperture (PSF) correction, no colour or cross-image calibration; error bars are not drawn (background scatter only, in the CSV). Wavelength = the image's own value at the star's pixel.</span>`;
}

// Key directly under the chart: filled / hollow and one shape per season.
function renderKey() {
  const pts = visiblePoints();
  const dot = (filled, shape = 'circle') => `<svg width="14" height="14" viewBox="-7 -7 14 14"><g fill="${filled ? '#EDE5DA' : '#15110E'}" stroke="#EDE5DA" stroke-width="1.4">${shapePath(shape, 0, 0, 4.5)}</g></svg>`;
  const used = new Set(S.points.map(p => p.season));
  const seasons = S.seasons.filter(s => used.has(s.i) && (S.season === 'all' || S.season === s.i));
  const other = pts.some(isOther) ? `<span><svg width="14" height="14" viewBox="-7 -7 14 14"><circle r="4.5" fill="#15110E" stroke="${OTHER}" stroke-width="1.4"/></svg> light from another source</span>` : '';
  $('key').innerHTML = `<span>${dot(true)} clean aperture</span><span>${dot(false)} flagged pixels in the aperture</span>` + other +
    seasons.map(s => `<span>${dot(true, SHAPES[s.i % SHAPES.length])} ${esc(s.label)}</span>`).join('') +
    `<span class="dim">Colour = band (wavelength) · ${esc(BAND_NOTE)}</span>`;
  const nFlag = pts.filter(p => p.flagged).length;
  $('flagNote').hidden = !(pts.length >= 5 && nFlag / pts.length >= 0.9);
}

function renderApertures() {
  $('apSeg').innerHTML = APERTURES.map(a => `<button class="seg-btn" type="button" data-v="${a.id}" aria-pressed="${a === S.aperture}">${a.label}</button>`).join('');
  $('apTxt').textContent = `Aperture radius ${S.aperture.rAp} px (${(S.aperture.rAp * PIXEL_ARCSEC).toFixed(1)}″); background ring ${S.aperture.rIn}–${S.aperture.rOut} px.`;
}
$('apSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.aperture = APERTURES.find(a => a.id === b.dataset.v) ?? APERTURES[1];
  renderApertures(); remeasure();
});

function shapeIcon(i) {
  return `<svg width="14" height="14" viewBox="-7 -7 14 14" fill="currentColor">${shapePath(SHAPES[i % SHAPES.length], 0, 0, 5)}</svg>`;
}
function renderSeasons() {
  const opts = [{ v: 'all', html: `All seasons <span class="num dim">${S.images.length || ''}</span>` },
    ...S.seasons.map(s => ({ v: String(s.i), html: `${shapeIcon(s.i)}${esc(s.label)} <span class="num dim">${s.n}</span>` }))];
  $('seasons').innerHTML = opts.map(o => `<button class="key" type="button" data-v="${o.v}" aria-pressed="${String(S.season) === o.v}">${o.html}</button>`).join('');
  updateFill();
}
$('seasons').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.season = b.dataset.v === 'all' ? 'all' : Number(b.dataset.v);
  renderSeasons(); renderKey(); draw();
});
function seasonImages() {
  return S.season === 'all' ? [] : S.images.filter(im => seasonIndex(im.mjdStart, S.seasons) === S.season);
}
function updateFill() {
  const b = $('fillSeason'), list = seasonImages(), left = list.filter(im => !S.queued.has(im.uri)).length;
  b.hidden = S.season === 'all' || !left;
  b.textContent = left > 200 ? `Measure 200 more images of this season (${left} left)` : `Measure the other ${left} image${left === 1 ? '' : 's'} of this season`;
}
$('fillSeason').onclick = () => {
  const left = seasonImages().filter(im => !S.queued.has(im.uri));
  enqueue(pickImages(left, Math.ceil(200 / 6)).slice(0, 200));
};
$('more').onclick = () => enqueue(pickImages(S.images, perDet(), { skip: S.queued }));
function perDet() { return Number($('perDet').querySelector('[aria-pressed=true]')?.dataset.v ?? 16); }
$('perDet').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('perDet').children) x.setAttribute('aria-pressed', String(x === b));
  if (S.images.length) enqueue(pickImages(S.images, perDet(), { skip: S.queued }));
};
$('ySeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.log = b.dataset.v === 'log';
  for (const x of $('ySeg').children) x.setAttribute('aria-pressed', String(x === b));
  draw();
});
$('csv').onclick = () => {
  const pts = visiblePoints().slice().sort((a, b) => a.um - b.um);
  download(`star-shift-spectrum-${slug(S.target?.name || `${S.target?.ra?.toFixed(3)}_${S.target?.dec?.toFixed(3)}`)}.csv`, pointsToCSV(pts, S.seasons));
};

// ---- chart ------------------------------------------------------------------------------------
function visiblePoints() {
  return S.points.filter(p => S.season === 'all' || p.season === S.season);
}

let drawTimer = null;
function scheduleDraw() { if (!drawTimer) drawTimer = setTimeout(() => { drawTimer = null; draw(); }, 80); }

function shapePath(kind, x, y, r) {
  if (kind === 'square') { const s = r * 0.88; return `<rect x="${x - s}" y="${y - s}" width="${2 * s}" height="${2 * s}"/>`; }
  if (kind === 'triangle') { const h = r * 1.15; return `<path d="M${x} ${y - h}L${x + h} ${y + h * 0.8}L${x - h} ${y + h * 0.8}Z"/>`; }
  if (kind === 'diamond') { const h = r * 1.25; return `<path d="M${x} ${y - h}L${x + h} ${y}L${x} ${y + h}L${x - h} ${y}Z"/>`; }
  return `<circle cx="${x}" cy="${y}" r="${r}"/>`;
}

let layout = null;
function draw() {
  const svg = $('svg'), box = $('plot').getBoundingClientRect();
  const W = Math.max(320, box.width), H = Math.max(220, box.height);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const narrow = W < 600; // phone: shorter labels so band names don't collide
  const m = { l: narrow ? 52 : 70, r: narrow ? 10 : 20, t: 34, b: 62 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const pts = visiblePoints().filter(p => !S.log || p.mJy > 0);
  const yr = yRange(pts.map(p => p.mJy), S.log);
  const X = (um) => m.l + ((um - X_RANGE.min) / (X_RANGE.max - X_RANGE.min)) * pw;
  const Y = S.log ? (v) => m.t + ph - ((Math.log10(v) - Math.log10(yr.lo)) / (Math.log10(yr.hi) - Math.log10(yr.lo))) * ph
    : (v) => m.t + ph - ((v - yr.lo) / (yr.hi - yr.lo)) * ph;
  const muted = '#B5A898', grid = 'rgba(255,235,210,.08)';
  let s = '';
  // the six colour bands behind, with names
  for (const b of DEFAULT_BANDS) {
    const x0 = X(Math.max(b.min, X_RANGE.min)), x1 = X(Math.min(b.max, X_RANGE.max));
    // '…band' name when it fits its column (about 5.8 px a letter at 11 px), else shorter forms
    const fits = (t) => !narrow && t.length * 5.8 <= x1 - x0 + 14;
    const full = bandName(b), label = fits(full) ? full : fits(b.name) ? b.name : (SHORT[b.id] ?? b.name);
    s += `<rect x="${x0}" y="${m.t}" width="${x1 - x0}" height="${ph}" fill="${b.color}" opacity=".07"/>`;
    s += `<text x="${(x0 + x1) / 2}" y="${m.t - 12}" fill="${b.color}" text-anchor="middle" font-family="Instrument Sans,system-ui,sans-serif" font-size="11" font-weight="600">${esc(label)}</text>`;
  }
  // grid + y axis
  const yt = S.log ? logTicks(yr.lo, yr.hi) : niceTicks(yr.lo, yr.hi, 6);
  for (const v of yt) {
    const y = Y(v);
    s += `<line x1="${m.l}" x2="${m.l + pw}" y1="${y}" y2="${y}" stroke="${grid}"/>`;
    s += `<text x="${m.l - 8}" y="${y + 4}" fill="${muted}" text-anchor="end">${fmtValue(v)}</text>`;
  }
  if (!S.log && yr.lo < 0 && yr.hi > 0) s += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(0)}" y2="${Y(0)}" stroke="rgba(255,235,210,.22)"/>`;
  for (let um = 1; um <= 5; um += 0.5) {
    const x = X(um), major = Number.isInteger(um);
    s += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ph}" stroke="${grid}"/>`;
    if (major || pw > 520) s += `<text x="${x}" y="${m.t + ph + 16}" fill="${muted}" text-anchor="middle">${um.toFixed(major ? 0 : 1)}</text>`;
  }
  s += `<text x="${m.l + pw / 2}" y="${H - 6}" fill="${muted}" text-anchor="middle">Wavelength (µm)</text>`;
  s += narrow ? `<text x="4" y="${m.t - 12}" fill="${muted}">mJy${S.log ? ' (log)' : ''}</text>`
    : `<text transform="translate(16 ${m.t + ph / 2}) rotate(-90)" fill="${muted}" text-anchor="middle">Flux density (mJy)${S.log ? ', log' : ''}</text>`;
  // detector spans under the axis (they overlap a little at the edges); Expert only
  for (const d of isExpert() ? DETECTORS : []) {
    const y = m.t + ph + 27 + (d.d % 2 ? 0 : 13); // two rows, room for 11 px labels
    s += `<line x1="${X(d.min)}" x2="${X(Math.min(d.max, X_RANGE.max))}" y1="${y}" y2="${y}" stroke="${muted}" stroke-width="3" opacity=".55"/>`;
    s += `<text x="${X(d.min) + 2}" y="${y - 3}" fill="${muted}" font-size="11">D${d.d}</text>`;
  }
  // ice features
  for (const f of FEATURES) {
    const x = X(f.um);
    s += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ph}" stroke="#FFF6E8" stroke-opacity=".45" stroke-dasharray="4 4"/>`;
    s += `<text x="${x + 5}" y="${m.t + 14}" fill="#FFF6E8" fill-opacity=".75">${esc(narrow ? f.label.split(' ')[0] : f.label)}</text>`;
  }
  // points: band colour; hollow when flagged; shape = season
  const placed = [];
  for (const p of pts) {
    const x = X(p.um), y = Y(p.mJy);
    if (!Number.isFinite(y) || y < m.t - 4 || y > m.t + ph + 4) continue;
    placed.push({ p, x, y });
    const shape = SHAPES[Math.max(0, p.season) % SHAPES.length];
    const st = isOther(p) ? `fill="#15110E" stroke="${OTHER}" stroke-width="1.5" data-other="1"`
      : p.flagged ? `fill="#15110E" stroke="${p.color}" stroke-width="1.5"` : `fill="${p.color}" stroke="rgba(11,9,7,.6)" stroke-width=".75"`;
    s += `<g ${st}>${shapePath(shape, x, y, W < 700 ? 3 : 3.6)}</g>`; // ~6 px markers on a phone-width chart
  }
  if (S.hover) {
    const h = placed.find(q => q.p === S.hover);
    if (h) s += `<circle cx="${h.x}" cy="${h.y}" r="8" fill="none" stroke="#FFF6E8" stroke-width="1.5"/>`;
  }
  if (!pts.length && S.total) s += `<text x="${m.l + pw / 2}" y="${m.t + ph / 2}" fill="${muted}" text-anchor="middle" font-family="Instrument Sans,system-ui,sans-serif" font-size="13">${S.done < S.total ? 'Measuring… dots appear as the images arrive' : S.season !== 'all' ? 'No measured images in this season yet' : 'No image could be measured here'}</text>`;
  svg.innerHTML = s;
  layout = { placed };
}

function showTip(h, ev) {
  const tip = $('tip');
  if (!h) { tip.hidden = true; return; }
  const p = h.p, s = S.seasons[p.season];
  const plainDay = new Date(`${p.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  tip.innerHTML = (isExpert()
    ? `<b>${fmtValue(p.mJy)} mJy</b> ± ${fmtValue(p.errMJy)} (background)<br>λ ${p.um.toFixed(3)} µm · D${p.detector} · ${esc(bandName(bandAt(p.um)) || (p.band ?? ''))}<br>${p.date} ${p.time} UTC${s ? ` · ${esc(s.label)}` : ''}<br>`
    : `<b>${fmtValue(p.mJy)} mJy</b><br>${p.um.toFixed(2)} µm · ${esc(bandName(bandAt(p.um)) || (p.band ?? ''))}<br>${plainDay}<br>`) +
    (isOther(p) ? `Light from another source${(src => (src ? ` (Gaia G ${src.g.toFixed(1)}, ${src.sepArcsec.toFixed(1)}″ away)` : ''))(S.otherSrc[S.otherDets.get(p.detector)])}, not ${esc(S.target?.name || 'this star')}<br>` : '') +
    (p.flagged ? `Flagged in aperture: ${p.kinds.map(k => ({ cosmic: 'cosmic ray', overflow: 'overflow', scatter: 'scattered light', other: 'other' }[k])).join(', ')}<br>` : '') +
    `<span style="color:#B5A898">Click to open this image in the viewer</span>`;
  tip.hidden = false;
  const box = $('plot').getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = h.x + 14, y = h.y - th - 10;
  if (x + tw > box.width - 8) x = h.x - tw - 14;
  if (y < 4) y = h.y + 14;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}

function nearest(ev) {
  if (!layout) return null;
  const box = $('plot').getBoundingClientRect();
  const vb = $('svg').viewBox.baseVal, sx = vb.width / box.width, sy = vb.height / box.height;
  const mx = (ev.clientX - box.left) * sx, my = (ev.clientY - box.top) * sy;
  let best = null, bd = 14 * 14;
  for (const q of layout.placed) { const d = (q.x - mx) ** 2 + (q.y - my) ** 2; if (d < bd) { bd = d; best = q; } }
  return best;
}
$('plot').addEventListener('mousemove', (ev) => {
  const h = nearest(ev);
  if ((h?.p ?? null) !== S.hover) { S.hover = h?.p ?? null; draw(); }
  showTip(h, ev);
  $('plot').style.cursor = h ? 'pointer' : 'default';
});
$('plot').addEventListener('mouseleave', () => { S.hover = null; showTip(null); draw(); });
$('plot').addEventListener('click', (ev) => {
  const h = nearest(ev);
  if (h) location.href = targetViewerUrl(S.target, h.p.mjd, h.p.detector); // the detector too: D1/D4 share exposure times
});
new ResizeObserver(() => scheduleDraw()).observe($('plot'));

renderApertures();
onExpert(() => scheduleDraw()); // detector spans come and go with Expert
let currentQ = initShell((q) => { currentQ = q; load(q); });
load(currentQ);
