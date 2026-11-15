// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Telescope compare, the fourth view in the time-lapse (DESIGN.md 31a): the same patch from
// SPHEREx (follows the flip-book), AllWISE and 2MASS, side by side, north up, at one angular
// scale. Each image keeps its own pixels (drawn with its own WCS, no resampling). Each panel
// has the dashed target ring at that image's own date, and one dotted Ghost trail runs through
// all three positions with a year tick at each. Images: OBSERVED; rings and trail: COMPUTED.
import { gridToWorld } from '../../core/align.js';
import { hasMotion } from '../../core/ghost.js';
import { fieldFor, skyToScreen, imageAffine, nearestPixel, positionsAt, yearOf, stretch, pxPerArcsec, NOMINAL } from './geometry.js';
import { SURVEYS, loadSurvey } from './surveys.js';

const IV = (a) => `rgba(255,246,232,${a})`;
const ORDER = ['spherex', 'wise', 'twomass'];

export function createTelescopes(ctx) {
  const { $, V, P, esc } = ctx;
  const T = { on: false, key: null, field: null, star: null, res: {}, ctl: null, off: {}, last: {} };
  const root = $('tele'), panels = $('telePanels');

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
    panels.querySelectorAll('.tele-msg').forEach(m => m.addEventListener('click', (e) => { if (e.target.closest('.tele-retry')) start(true); }));
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
    for (const id of ['wise', 'twomass']) {
      T.res[id] = { state: 'loading' };
      loadSurvey(SURVEYS[id], fld, { base: ctx.base, signal: ctl.signal })
        .then(r => { if (ctl.signal.aborted) return; T.res[id] = r.none ? { state: 'none' } : { state: 'ok', data: r }; draw(); })
        .catch(e => { if (ctl.signal.aborted || e?.name === 'AbortError') return; T.res[id] = { state: 'error', why: e?.message || String(e) }; draw(); });
    }
    draw();
  }

  // Offscreen image in the survey's own pixels, stretched on its own (asinh 2-99.7%).
  function offscreen(id, values, nx, ny) {
    if (T.off[id]?.src === values) return T.off[id].cv;
    const s = stretch(values), cv = document.createElement('canvas'); cv.width = nx; cv.height = ny;
    const g = cv.getContext('2d'), im = g.createImageData(nx, ny);
    for (let i = 0; i < nx * ny; i++) {
      const v = values[i];
      if (v == null || !Number.isFinite(v)) { im.data[4 * i + 3] = 0; continue; }
      const t = s.map(v); im.data[4 * i] = t; im.data[4 * i + 1] = Math.round(t * 0.965); im.data[4 * i + 2] = Math.round(t * 0.91); im.data[4 * i + 3] = 255;
    }
    g.putImageData(im, 0, 0); T.off[id] = { src: values, cv }; return cv;
  }
  // FITS rows run bottom-up; the canvas wants row 0 at the top.
  function fitsRowsTopDown(img) {
    const { nx, ny, data } = img, out = new Array(nx * ny);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) out[(ny - 1 - y) * nx + x] = data[y * nx + x];
    return out;
  }

  // outside the SPHEREx cutout: the same calm flat no-data fill as the viewer (erender.js), no hatching
  function hatch(g, w, h) {
    g.fillStyle = '#100D0B'; g.fillRect(0, 0, w, h);
  }

  function sizePanels() {
    const box = root.getBoundingClientRect(), phone = innerWidth < 700;
    const head = root.querySelector('.tele-head')?.offsetHeight || 40;
    // room left for captions and the note, measured from the last draw (captions wrap with width)
    const capH = Math.max(0, ...[...panels.querySelectorAll('.tele-p')].map(f => f.offsetHeight - (f.querySelector('.tele-box')?.offsetHeight || 0))) || 104;
    const noteH = ($('teleNote')?.offsetHeight || 18) + 10;
    const side = phone ? Math.floor(Math.min(box.width - 4, 420))
      : Math.floor(Math.max(120, Math.min((box.width - 2 * 18) / 3, box.height - head - 10 - capH - noteH)));
    return side;
  }

  function draw() {
    if (!T.on) return;
    if (!panels.children.length) build();
    const fld = T.field; if (!fld) return;
    const side = sizePanels(), dpr = Math.min(devicePixelRatio || 1, 2), zoom = ctx.zoom?.() || 1;
    const view = { ...fld, sizeArcsec: fld.sizeArcsec / zoom };
    const star = motionStar(), fx = fixedPos(), ep = epochs();
    const pos = Object.fromEntries(ORDER.map(id => [id, star && Number.isFinite(ep[id]) ? positionsAt(star, fx, [ep[id]])[0] : fx]));
    const f = curFrame();
    for (const id of ORDER) {
      const fig = panels.querySelector(`[data-s="${id}"]`), cv = fig.querySelector('canvas'), msg = fig.querySelector('.tele-msg');
      cv.style.width = cv.style.height = side + 'px'; fig.style.width = side + 'px';
      const W = Math.round(side * dpr); if (cv.width !== W) { cv.width = W; cv.height = W; }
      const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); hatch(g, W, W, dpr);
      let pix = null, ok = false; msg.innerHTML = '';
      if (id === 'spherex') {
        if (f && V.grid) {
          const n = V.grid.n, off = offscreen('spherex', f.d, n, n);
          const m = imageAffine((i, j) => gridToWorld(V.grid, i, j), n, n, view, side, { flipY: false });
          drawImg(g, off, m, dpr, V.grid.scale * pxPerArcsec(view, side) * dpr); ok = true; pix = V.grid.scale;
        } else msg.textContent = 'Waiting for the first SPHEREx image…';
      } else {
        const r = T.res[id] || { state: 'loading' };
        if (r.state === 'ok') {
          const { image, wcs } = r.data, off = offscreen(id, fitsRowsTopDown(image), image.nx, image.ny);
          const near = nearestPixel(wcs, view.ra0, view.dec0, image.nx, image.ny);
          const m = imageAffine(wcs.pixToWorld, image.nx, image.ny, view, side, { flipY: true, near });
          drawImg(g, off, m, dpr, wcs.scaleArcsec * pxPerArcsec(view, side) * dpr); ok = true; pix = wcs.scaleArcsec;
        } else if (r.state === 'none') msg.innerHTML = '<b>No image of this patch</b>';
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
  }

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
        g.fillStyle = 'rgba(21,17,14,.78)'; g.fillRect(lx - 3 * dpr, ly - 8 * dpr, tw + 6 * dpr, 16 * dpr);
        g.fillStyle = k === id ? '#E3A86B' : IV(0.92); g.fillText(lab, lx, ly + 0.5);
      });
    }
    // the dashed target ring at THIS image's date (fixed 10″ radius, at least 9 px)
    const [gx, gy] = xy(pos[id]), R = Math.max(9, 10 * pxPerArcsec(view, side)) * dpr;
    g.setLineDash([4 * dpr, 3 * dpr]); g.lineWidth = 3.2 * dpr; g.strokeStyle = 'rgba(11,9,7,.5)'; g.beginPath(); g.arc(gx, gy, R, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.6 * dpr; g.strokeStyle = '#E3A86B'; g.beginPath(); g.arc(gx, gy, R, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  }

  const chip = (w) => `<span class="tele-chip">${w}</span>`;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateOf = (iso) => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(iso || '')); return m ? `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}` : '—'; }; // the app's "25 Aug 2025"
  function caption(fig, id, f, pix, star) {
    const cap = fig.querySelector('.tele-cap'), sub = fig.querySelector('.tele-sub');
    const px = pix ? `${pix < 2 ? pix.toFixed(pix < 1.2 ? 1 : 3).replace(/0+$/, '').replace(/\.$/, '') : pix.toFixed(2)}″ pixels` : '';
    if (id === 'spherex') {
      cap.innerHTML = `<b>SPHEREx</b> ${chip('SPACE')} in orbit · ${dateOf(f?.date)} · ${f?.um ? f.um.toFixed(2) + ' µm' : '—'}${f?.det ? ` (D${f.det})` : ''} · ${px || '6.15″ pixels'}`;
      const cut = V.grid ? Math.round(V.grid.n * V.grid.scale) : null, wide = cut && T.field && T.field.sizeArcsec / (ctx.zoom?.() || 1) > cut + 1;
      sub.textContent = f ? `Follows the flip-book: image ${P.i + 1} of ${V.F.length}, on the viewer's 6.15″ grid.${wide ? ` The SPHEREx cutout is ${cut}″ wide; the darker area is outside it.` : ''}` : '';
      return;
    }
    const r = T.res[id], d = r?.data, m = d?.meta;
    if (id === 'wise') {
      const dates = m?.first && m?.last ? `${dateOf(m.first)} to ${dateOf(m.last)}` : '2010 (dates load with the image)';
      cap.innerHTML = `<b>AllWISE</b> ${chip('SPACE')} in orbit · ${dates} · W1 ${m?.um ? m.um.toFixed(2) : '3.4'} µm · ${px || '1.375″ pixels'}`;
      sub.textContent = r?.state === 'ok' ? `One stacked image${m?.frames ? ` of ${m.frames} frames` : ''}, ${m?.first?.slice(0, 4) || '2010'}${star && m?.mid ? `. Ring at the middle frame, ${dateOf(m.mid)}` : ''}. Atlas image ${d.path.split('/').pop().replace('.fits', '')}.` : 'One stacked image, 2010.';
    } else {
      const site = m?.site ? `${m.site}` : 'Mt Hopkins, Arizona (north) or Cerro Tololo, Chile (south)';
      cap.innerHTML = `<b>2MASS</b> ${chip('GROUND')} ${esc(site)} · ${m?.date ? dateOf(m.date) : '1997–2001'} · Ks 2.16 µm · ${px || '1″ pixels'}`;
      sub.textContent = r?.state === 'ok' ? `One image, ${m?.date?.slice(0, 4) || '—'}${m?.iso ? `, ${m.iso.slice(11, 16)} UT` : ''}. ${m?.hemi === 'north' ? 'The northern 2MASS telescope (the south used Cerro Tololo, Chile).' : m?.hemi === 'south' ? 'The southern 2MASS telescope (the north used Mt Hopkins, Arizona).' : ''} Atlas pixels 1″ (camera pixels 2″).` : '2MASS: two 1.3 m telescopes, 1997–2001; the site is read from the image.';
    }
  }

  return {
    show(on) { T.on = on; root.hidden = !on; if (on) { if (!panels.children.length) build(); start(false); } else { T.ctl?.abort(); T.key = null; fitPhone(); } },
    draw, reset() { T.ctl?.abort(); T.key = null; T.res = {}; T.off = {}; T.field = null; panels.innerHTML = ''; },
    refresh() { if (T.on) start(false); }, // a frame list or motion change may need a new field
    state: T,
  };
}
