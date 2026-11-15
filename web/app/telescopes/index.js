// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Telescope compare, the fourth view in the time-lapse (DESIGN.md 31a): the same patch from
// SPHEREx (follows the flip-book), AllWISE and 2MASS, side by side, north up, at one angular
// scale. Each image keeps its own pixels (drawn with its own WCS, no resampling). Each panel
// has the dashed target ring at that image's own date, and one dotted Ghost trail runs through
// all three positions with a year tick at each. Images: OBSERVED; rings and trail: COMPUTED.
import { gridToWorld, makeGrid } from '../../core/align.js';
import { hasMotion } from '../../core/ghost.js';
import { fieldFor, skyToScreen, imageAffine, nearestPixel, positionsAt, yearOf, stretch, pxPerArcsec, NOMINAL } from './geometry.js';
import { SURVEYS, loadSurvey } from './surveys.js';

const IV = (a) => `rgba(255,246,232,${a})`;
// the look on <html> (access.js): the default look draws the ice ramp, navy and its yellow ring; 'classic' keeps the warm grey and copper
const classic = () => document.documentElement.dataset.axLook === 'classic';
const ringCol = () => (classic() ? '#E3A86B' : getComputedStyle(document.documentElement).getPropertyValue('--ring').trim() || '#EAF42F');
const ORDER = ['spherex', 'wise', 'twomass'];

export function createTelescopes(ctx) {
  const { $, V, P, esc } = ctx;
  const T = { on: false, key: null, field: null, star: null, res: {}, ctl: null, sub: {}, ringAt: null, off: {}, last: {} };
  const root = $('tele'), panels = $('telePanels');
  // b10: a field wider than the viewer's cutout (Barnard: ~420″ vs 150″) leaves SPHEREx a small square in a dark
  // panel. When the flip-book is paused, one wider cutout of the image on screen (same 6.15″ pixels, ctx.wide)
  // fills the SPHEREx panel like the other two; while it plays, the viewer's own cutouts are shown.
  const W = { key: null, grid: null, d: null, ctl: null };
  function wideFor(f) {
    if (!ctx.wide || !f?.raw?.uri || !T.field || !V.grid || T.field.sizeArcsec <= V.grid.n * V.grid.scale + 1) return null;
    const key = f.raw.uri + '|' + T.key;
    if (W.key === key) return W.d ? W : null;
    if (P.playing) return null;
    W.ctl?.abort(); const c = W.ctl = new AbortController();
    Object.assign(W, { key, d: null, grid: makeGrid(T.field.ra0, T.field.dec0, T.field.sizeArcsec + 20, V.grid.scale) });
    ctx.wide(f, W.grid, c.signal).then(r => { if (W.ctl === c && T.on) { W.d = r.data; draw(); } }).catch(() => { /* keep the viewer's cutout */ });
    return null;
  }

  const curFrame = () => V.F[Math.min(P.i, V.F.length - 1)] || null;
  const fixedPos = () => (V.grid ? { ra: V.grid.ra0, dec: V.grid.dec0 } : V.target ? { ra: V.target.ra, dec: V.target.dec } : null);
  function motionStar() {
    const s = ctx.GH?.G?.star; if (s && hasMotion(s)) return s;
    return V.target && hasMotion(V.target) ? V.target : null;
  }
  // epochs: real header dates once known; nominal survey years until then
  function epochs() {
    const f = curFrame();
    return { spherex: f?.mjd ?? null, wise: T.res.wise?.data?.meta?.mjd ?? NOMINAL.wise, twomass: T.res.twomass?.data?.meta?.mjd ?? NOMINAL.twomass };
  }

  function build() {
    panels.innerHTML = ORDER.map(id => `<figure class="tele-p" data-s="${id}">
      <div class="tele-box"><canvas role="img"></canvas><div class="tele-msg"></div></div>
      <figcaption class="tele-cap num"></figcaption><p class="tele-sub"></p></figure>`).join('');
    panels.querySelectorAll('.tele-msg').forEach(m => m.addEventListener('click', (e) => { if (e.target.closest('.tele-retry')) loadOne(m.closest('.tele-p').dataset.s); }));
  }

  // Field: holds the target at every survey date (1997-2001 window for 2MASS) with a margin.
  function planField() {
    const fx = fixedPos(); if (!fx) return null;
    // SPHEREx dates from the plan (fixed once planned), so arriving frames never move the field
    const plan = V.plannedMjds?.length ? V.plannedMjds : V.F.map(f => f.mjd);
    const star = motionStar(), mjds = plan.length ? [Math.min(...plan), Math.max(...plan)] : [];
    const pts = star ? positionsAt(star, fx, [NOMINAL.twomass - 1.6 * 365.25, NOMINAL.twomass + 2.3 * 365.25, NOMINAL.wise, ...mjds]) : [fx];
    if (!star) pts.push(fx);
    const f = fieldFor(pts, { minArcsec: V.grid ? Math.round(V.grid.n * V.grid.scale) : 150 });
    // snap the centre to a 10″ grid: a SIMBAD -> Gaia motion update then keeps the same field
    // (and the same cached IRSA answers) instead of asking IRSA again for a 1″ shift
    const q = 10 / 3600, cosd = Math.cos(f.dec0 * Math.PI / 180) || 1;
    return { ...f, ra0: Math.round(f.ra0 * cosd / q) * q / cosd, dec0: Math.round(f.dec0 / q) * q };
  }

  function start(force) {
    const fld = planField(); if (!fld) return;
    const key = `${fld.ra0.toFixed(5)},${fld.dec0.toFixed(5)},${fld.sizeArcsec}`;
    if (!force && key === T.key) { draw(); return; }
    T.ctl?.abort(); const ctl = T.ctl = new AbortController();
    T.key = key; T.field = fld; T.res = {}; T.off = {};
    // where the ring falls at a given date: 2MASS picks the tiles that really show the star then
    const star = motionStar(), fx = fixedPos();
    T.ringAt = (mjd) => positionsAt(star, fx, [Number.isFinite(mjd) ? mjd : NOMINAL.twomass])[0];
    for (const id of ['wise', 'twomass']) loadOne(id, false);
    draw();
  }

  // One survey panel. IRSA outage (judging panel round 3: 45-75 s of 'Asking IRSA…', then a bare 'HTTP 502'):
  // after the first busy answer (5xx, no connection) or 20 s with no answer the panel says so and offers
  // Retry at once; the polite retries go on underneath, and an image that still arrives replaces the note.
  const SLOW_MS = 20000;
  function loadOne(id, redraw = true) {
    const fld = T.field, parent = T.ctl; if (!fld || !parent || parent.signal.aborted) return;
    T.sub[id]?.abort(); const c = T.sub[id] = new AbortController();
    const signal = AbortSignal.any([parent.signal, c.signal]), dead = () => signal.aborted || T.sub[id] !== c;
    const r = T.res[id] = { state: 'loading' };
    const down = (why) => { if (dead() || T.res[id] !== r) return; r.state = 'down'; r.why = why; draw(); };
    const timer = setTimeout(() => down('no answer in 20 s'), SLOW_MS);
    loadSurvey(SURVEYS[id], fld, { base: ctx.base, signal, ringAt: T.ringAt, onBusy: (st) => down(st ? `HTTP ${st}` : 'no connection') })
      .then(x => { if (dead()) return; T.res[id] = x.none ? { state: 'none' } : { state: 'ok', data: x }; draw(); })
      .catch(e => {
        if (dead() || e?.name === 'AbortError') return;
        const st = e?.status; // a 5xx or no connection (0) is the outage; anything else says what went wrong
        T.res[id] = { state: (st === 0 || st >= 500) && !/Upstream HTTP (4\d\d|500)/.test(e?.text || '') ? 'down' : 'error', why: e?.message || String(e), done: true }; draw();
      })
      .finally(() => clearTimeout(timer));
    if (redraw) draw();
  }

  // Offscreen image in the survey's own pixels, stretched on its own (asinh 2-99.7%).
  // `src` keys the cache; `values` may be a function (built only on a cache miss); `s` = shared stretch
  function offscreen(id, src, nx, ny, values = src, s = null) {
    const look = classic() ? 'classic' : 'ice', R = window.MockRender;
    if (T.off[id]?.src === src && T.off[id].look === look) return T.off[id].cv;
    if (typeof values === 'function') values = values();
    s = s || stretch(values); const cv = document.createElement('canvas'); cv.width = nx; cv.height = ny;
    const g = cv.getContext('2d'), im = g.createImageData(nx, ny);
    for (let i = 0; i < nx * ny; i++) {
      const v = values[i];
      if (v == null || !Number.isFinite(v)) { im.data[4 * i + 3] = 0; continue; }
      const t = s.map(v);
      if (look === 'ice' && R?.rampRGB) { const c = R.rampRGB('ice', t / 255); im.data[4 * i] = c[0]; im.data[4 * i + 1] = c[1]; im.data[4 * i + 2] = c[2]; }
      else { im.data[4 * i] = t; im.data[4 * i + 1] = Math.round(t * 0.965); im.data[4 * i + 2] = Math.round(t * 0.91); }
      im.data[4 * i + 3] = 255;
    }
    g.putImageData(im, 0, 0); T.off[id] = { src, cv, look }; return cv;
  }
  // FITS rows run bottom-up; the canvas wants row 0 at the top.
  function fitsRowsTopDown(img) {
    const { nx, ny, data } = img, out = new Array(nx * ny);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) out[(ny - 1 - y) * nx + x] = data[y * nx + x];
    return out;
  }

  // outside the SPHEREx cutout: the same calm flat no-data fill as the viewer (erender.js), no hatching
  function hatch(g, w, h) {
    g.fillStyle = classic() ? '#100D0B' : '#060C18'; g.fillRect(0, 0, w, h);
  }

  function sizePanels() {
    // desktop: the result plate sits at the foot of the stage (ui.js); keep the panels and the note above it
    const plate = $('resultPlate'), ph = innerWidth >= 700 && plate && !plate.hidden && root.parentElement?.contains(plate) ? plate.offsetHeight : 0;
    root.style.bottom = ph ? `${ph + 16}px` : '';
    const box = root.getBoundingClientRect(), phone = innerWidth < 700;
    const head = root.querySelector('.tele-head')?.offsetHeight || 40;
    // room left for captions and the note, measured from the last draw (captions wrap with width)
    const capH = Math.max(0, ...[...panels.querySelectorAll('.tele-p')].map(f => f.offsetHeight - (f.querySelector('.tele-box')?.offsetHeight || 0))) || 104;
    const noteH = ($('teleNote')?.offsetHeight || 18) + 10;
    const side = phone ? Math.floor(Math.min(box.width - 4, 420))
      : Math.floor(Math.max(120, Math.min((box.width - 2 * 18) / 3, box.height - head - 20 - capH - noteH)));
    return side;
  }
  // caption column: as wide as a third of the stage allows (up to 260 px), even when a short stage
  // makes the image small, so captions wrap to fewer lines and stay inside the stage (QA 1366x640)
  function figWidth(side) {
    if (innerWidth < 700) return side;
    const w = Math.floor((root.getBoundingClientRect().width - 2 * 18) / 3);
    return Math.max(side, Math.min(w, 280));
  }

  function draw() {
    if (!T.on) return;
    if (!panels.children.length) build();
    const fld = T.field; if (!fld) return;
    const side = sizePanels(), figW = figWidth(side), dpr = Math.min(devicePixelRatio || 1, 2), zoom = ctx.zoom?.() || 1;
    const view = { ...fld, sizeArcsec: fld.sizeArcsec / zoom };
    const star = motionStar(), fx = fixedPos(), ep = epochs();
    const pos = Object.fromEntries(ORDER.map(id => [id, star && Number.isFinite(ep[id]) ? positionsAt(star, fx, [ep[id]])[0] : fx]));
    const f = curFrame();
    for (const id of ORDER) {
      const fig = panels.querySelector(`[data-s="${id}"]`), cv = fig.querySelector('canvas'), msg = fig.querySelector('.tele-msg');
      cv.style.width = cv.style.height = side + 'px'; fig.style.width = figW + 'px';
      const W = Math.round(side * dpr); if (cv.width !== W) { cv.width = W; cv.height = W; }
      const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); hatch(g, W, W, dpr);
      let pix = null, ok = false; msg.innerHTML = ''; msg.style.cssText = '';
      if (id === 'spherex') {
        if (f && V.grid) {
          const w = wideFor(f), gr = w ? w.grid : V.grid, n = gr.n, off = offscreen(w ? 'spherexW' : 'spherex', w ? w.d : f.d, n, n);
          const m = imageAffine((i, j) => gridToWorld(gr, i, j), n, n, view, side, { flipY: false });
          drawImg(g, off, m, dpr, gr.scale * pxPerArcsec(view, side) * dpr); ok = true; pix = gr.scale; T.wide = !!w;
        } else msg.textContent = 'Waiting for the first SPHEREx image…';
      } else {
        const r = T.res[id] || { state: 'loading' };
        if (r.state === 'ok') {
          // 2MASS may bring 2-3 tiles of one scan (one night): one stretch for all, the ring's tile on top
          const pcs = r.data.pieces || [r.data];
          const sv = r.data._s || (r.data._s = stretch(pcs.length > 1 ? pcs.flatMap(p => Array.from(p.image.data)) : r.data.image.data));
          for (let k = pcs.length - 1; k >= 0; k--) {
            const { image, wcs } = pcs[k], off = offscreen(id + k, image, image.nx, image.ny, () => fitsRowsTopDown(image), sv);
            const near = nearestPixel(wcs, view.ra0, view.dec0, image.nx, image.ny);
            const m = imageAffine(wcs.pixToWorld, image.nx, image.ny, view, side, { flipY: true, near });
            drawImg(g, off, m, dpr, wcs.scaleArcsec * pxPerArcsec(view, side) * dpr);
          }
          ok = true; pix = r.data.wcs.scaleArcsec;
        } else if (r.state === 'none') msg.innerHTML = '<b>No image of this patch</b>';
        else if (r.state === 'down') {
          // compact, so the note and Retry fit a 120 px panel (1366×640); a longer Expert note scrolls inside the panel
          msg.style.cssText = 'gap:4px;padding:6px;justify-content:safe center;overflow:auto;pointer-events:auto';
          msg.innerHTML = `<b style="font-size:.75rem;padding:2px 6px">IRSA's image service isn't answering right now</b>${x(`${r.done ? '' : 'Still asking. '}${esc(r.why)}`)}<button class="key tele-retry" type="button" style="min-height:24px;padding:2px 12px">Retry</button>`;
        }
        else if (r.state === 'error') msg.innerHTML = `<b>IRSA did not answer</b><span>${esc(r.why)}</span><button class="key tele-retry" type="button">Retry</button>`;
        else msg.innerHTML = `<span class="tele-wait">Asking IRSA for the ${SURVEYS[id].name} image…</span>`;
      }
      fig.classList.toggle('has-img', ok);
      if (ok) overlay(g, view, side, dpr, pos, id, star);
      caption(fig, id, f, pix, star);
      cv.setAttribute('aria-label', fig.querySelector('.tele-cap').textContent.replace(/\s+/g, ' '));
    }
    fitPhone();
    const span = Math.round(view.sizeArcsec);
    $('teleNote').textContent = `Each panel: ${span}″ across (${(span / 60).toFixed(1)}′), north up, east left, same scale.` +
      (fld.clipped ? ' The star moved further than one view can hold, so a ring may fall off the edge.' : '') +
      (star ? '' : ' No catalogued motion for this object: the ring marks the same spot in all three.');
    // captions and note were measured from the previous draw: if the text still runs past the stage, size once more
    if (innerWidth >= 700 && !refit && root.scrollHeight > root.clientHeight + 1) { refit = true; requestAnimationFrame(() => { draw(); refit = false; }); }
    moreCue();
  }
  let refit = false;
  // a very short stage (e.g. 1366×640 with Larger text) scrolls: fade the foot while more text lies below
  const moreCue = () => root.classList.toggle('tele-more', innerWidth >= 700 && root.scrollHeight - root.scrollTop - root.clientHeight > 2);
  root.addEventListener('scroll', moreCue, { passive: true });

  // Phone: the three panels stack, so the stage grows to hold them (the page scrolls, not the stage).
  function fitPhone() {
    const wrap = root.closest('.stage-wrap'); if (!wrap) return;
    if (T.on && innerWidth < 700) {
      const pad = ($('tools')?.offsetHeight || 0) + 16; // the stage tool strip sits at the bottom on phone: keep text above it
      root.style.paddingBottom = pad + 'px';
      const h = (root.querySelector('.tele-head')?.offsetHeight || 40) + panels.scrollHeight + (root.querySelector('.tele-note')?.offsetHeight || 16) + 80 + pad;
      Object.assign(wrap.style, { aspectRatio: 'auto', maxHeight: 'none', height: h + 'px' });
    } else { Object.assign(wrap.style, { aspectRatio: '', maxHeight: '', height: '' }); root.style.paddingBottom = ''; }
  }

  // Own pixels: no smoothing when a source pixel covers at least one device pixel. When it is
  // smaller (2MASS at a wide field), area-average so stars do not drop out between samples.
  function drawImg(g, off, m, dpr, devPerPix) {
    g.save(); g.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
    g.imageSmoothingEnabled = devPerPix < 1; if (devPerPix < 1) g.imageSmoothingQuality = 'high';
    g.drawImage(off, 0, 0); g.restore();
  }

  function overlay(g, view, side, dpr, pos, id, star) {
    const xy = (p) => skyToScreen(view, side, p.ra, p.dec).map(v => v * dpr);
    if (star) { // one dotted trail through the three dates, oldest first, with a year tick at each
      const ep = epochs(), seq = ORDER.slice().filter(k => Number.isFinite(ep[k])).sort((a, b) => ep[a] - ep[b]);
      const P = seq.map(k => xy(pos[k]));
      g.lineCap = 'round';
      for (const [w, col] of [[2.6 * dpr, 'rgba(11,9,7,.55)'], [1 * dpr, IV(0.9)]]) {
        g.setLineDash([2 * dpr, 4 * dpr]); g.lineWidth = w; g.strokeStyle = col; g.beginPath(); P.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      }
      g.setLineDash([]);
      const [x0, y0] = P[0], [x1, y1] = P[P.length - 1], len = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      g.font = `500 ${11 * dpr}px "IBM Plex Mono", ui-monospace, monospace`; g.textBaseline = 'middle';
      seq.forEach((k, i) => {
        const [x, y] = P[i]; g.strokeStyle = IV(0.9); g.lineWidth = 1.2 * dpr;
        g.beginPath(); g.moveTo(x - nx * 4 * dpr, y - ny * 4 * dpr); g.lineTo(x + nx * 4 * dpr, y + ny * 4 * dpr); g.stroke();
        const lab = String(yearOf(ep[k])), tw = g.measureText(lab).width, side2 = nx >= 0 ? 1 : -1;
        let lx = x + side2 * (nx * 14 * dpr) + (side2 > 0 ? 0 : -tw), ly = y + side2 * ny * 14 * dpr;
        lx = Math.max(2 * dpr, Math.min(side * dpr - tw - 2 * dpr, lx)); ly = Math.max(8 * dpr, Math.min(side * dpr - 8 * dpr, ly));
        g.fillStyle = classic() ? 'rgba(21,17,14,.78)' : 'rgba(6,12,24,.78)'; g.fillRect(lx - 3 * dpr, ly - 8 * dpr, tw + 6 * dpr, 16 * dpr);
        g.fillStyle = k === id ? ringCol() : IV(0.92); g.fillText(lab, lx, ly + 0.5);
      });
    }
    // the dashed target ring at THIS image's date (fixed 10″ radius, at least 9 px)
    const [gx, gy] = xy(pos[id]), R = Math.max(9, 10 * pxPerArcsec(view, side)) * dpr;
    g.setLineDash([4 * dpr, 3 * dpr]); g.lineWidth = 3.2 * dpr; g.strokeStyle = 'rgba(11,9,7,.5)'; g.beginPath(); g.arc(gx, gy, R, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.6 * dpr; g.strokeStyle = ringCol(); g.beginPath(); g.arc(gx, gy, R, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  }

  const chip = (w) => `<span class="tele-chip">${w}</span>`;
  const x = (t) => `<span class="x-only">${t}</span>`; // Expert-only detail (expert.js hides it in Simple)
  const sx = (simple, expert) => `<span class="s-only">${simple}</span>${x(expert)}`; // short Simple words, full Expert words
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateOf = (iso) => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(iso || '')); return m ? `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}` : '—'; }; // the app's "25 Aug 2025"
  function caption(fig, id, f, pix, star) {
    const cap = fig.querySelector('.tele-cap'), sub = fig.querySelector('.tele-sub');
    const px = pix ? `${pix < 2 ? pix.toFixed(pix < 1.2 ? 1 : 3).replace(/0+$/, '').replace(/\.$/, '') : pix.toFixed(2)}″ pixels` : '';
    if (id === 'spherex') {
      cap.innerHTML = `<b>SPHEREx</b> ${chip('SPACE')} in orbit · ${dateOf(f?.date)} · ${f?.um ? f.um.toFixed(2) + ' µm' : '—'}${f?.det ? x(` (D${f.det})`) : ''}${x(` · ${px || '6.15″ pixels'}`)}`;
      const cut = V.grid ? Math.round(V.grid.n * V.grid.scale) : null, wide = cut && !T.wide && T.field && T.field.sizeArcsec / (ctx.zoom?.() || 1) > cut + 1;
      // Simple keeps one short line per panel (fits a short stage with Larger text); Expert adds the detail
      sub.innerHTML = f ? `Follows the flip-book: image ${P.i + 1} of ${V.F.length}${x(T.wide ? `, a wider ${Math.round(W.grid.n * W.grid.scale)}″ cutout of it at 6.15″ pixels` : ", on the viewer's 6.15″ grid")}.${wide ? sx(' Dark: outside its cutout.', ` The SPHEREx cutout is ${cut}″ wide; the darker area is outside it.`) : ''}` : '';
      return;
    }
    const r = T.res[id], d = r?.data, m = d?.meta;
    if (id === 'wise') {
      const mon = (iso) => dateOf(iso).replace(/^\d+ /, ''), dates = m?.first && m?.last ? sx(m.first.slice(0, 4) === m.last.slice(0, 4) ? mon(m.first).slice(0, 3) + '–' + mon(m.last) : `${mon(m.first)} – ${mon(m.last)}`, `${dateOf(m.first)} to ${dateOf(m.last)}`) : '2010 (dates load with the image)';
      cap.innerHTML = `<b>AllWISE</b> ${chip('SPACE')} in orbit · ${dates} · W1 ${m?.um ? m.um.toFixed(2) : '3.4'} µm${x(` · ${px || '1.375″ pixels'}`)}`;
      sub.innerHTML = r?.state === 'ok' ? `One stacked image${m?.frames ? ` of ${m.frames} frames` : ''}${x(`, ${m?.first?.slice(0, 4) || '2010'}${star && m?.mid ? `. Ring at the middle frame, ${dateOf(m.mid)}` : ''}. Atlas image ${esc(d.path.split('/').pop().replace('.fits', ''))}`)}.` : 'One stacked image, 2010.';
    } else {
      const site = m?.site ? `${m.site}` : 'Mt Hopkins, Arizona (north) or Cerro Tololo, Chile (south)';
      cap.innerHTML = `<b>2MASS</b> ${chip('GROUND')} ${esc(site)} · ${m?.date ? dateOf(m.date) : '1997–2001'} · Ks 2.16 µm${x(` · ${px || '1″ pixels'}`)}`;
      const nP = d?.pieces?.length || 1, img = nP > 1 ? `${nP === 2 ? 'Two' : 'Three'} adjacent images from one scan` : 'One image';
      sub.innerHTML = r?.state === 'ok' ? `${img}${x(`, ${m?.date?.slice(0, 4) || '—'}${m?.iso ? `, ${m.iso.slice(11, 16)} UT` : ''}`)}.${x(` ${m?.hemi === 'north' ? 'The northern 2MASS telescope (the south used Cerro Tololo, Chile).' : m?.hemi === 'south' ? 'The southern 2MASS telescope (the north used Mt Hopkins, Arizona).' : ''} Atlas pixels 1″ (camera pixels 2″).`)}` : '2MASS: two 1.3 m telescopes, 1997–2001; the site is read from the image.';
    }
  }

  return {
    show(on) { T.on = on; root.hidden = !on; if (on) { if (!panels.children.length) build(); start(false); } else { T.ctl?.abort(); T.key = null; fitPhone(); } },
    draw, reset() { T.ctl?.abort(); W.ctl?.abort(); W.key = null; W.d = null; T.key = null; T.res = {}; T.off = {}; T.field = null; panels.innerHTML = ''; },
    refresh() { if (T.on) start(false); }, // a frame list or motion change may need a new field
    state: T,
  };
}
