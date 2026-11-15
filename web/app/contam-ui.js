// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Layers bar (IMAGE · VARIANCE · ZODI · WAVE), flag marks on the stage, and the FLAGS
// legend + "hide images" filter (team feature B, DESIGN.md section 23). ui.js owns the
// flip-book; this module only draws on its canvas and keeps its own small state.

import { KINDS, pixelKinds, flagNamesOf, countKinds, visibleFrames, frameHas, layerRange, classifyFrame, hideReason, HIDE_KINDS, HIDE_IDS, bitsNamed, CORE_PX } from '../core/contam.js';
import { mapLimit } from '../core/irsa.js';
import { stackFrames } from '../core/align.js';
import { loadLayers, waveMap, seasons } from './data.js';

const IVORY = '#FFF6E8', UNDER = 'rgba(11,9,7,.8)';
export const NEAR_PX = CORE_PX; // "touches the star": within 2 grid pixels (~12″) of the predicted position
export const LAYERS = {
  image: { label: 'IMAGE', tip: 'The picture itself', tag: 'obs' },
  variance: { label: 'VARIANCE', tip: 'How uncertain each pixel is', tag: 'obs' },
  zodi: { label: 'ZODI', tip: 'Glow from dust in our Solar System (the archive\'s model)', tag: 'calc' },
  wave: { label: 'WAVE', tip: 'The wavelength each pixel was measured at', tag: 'obs' },
};
const ICON = {
  cosmic: '<path d="M5 5l6 6M11 5l-6 6"/>',
  overflow: '<path d="M8.5 2.5h5v5z" fill="currentColor"/>',
  scatter: '<circle cx="4.5" cy="11.5" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="11.5" cy="4.5" r="1.3" fill="currentColor"/>',
  airglow: '<path d="M2 8.5c1.5-3 3-3 4 0s2.5 3 4 0 2.5-3 4 0"/>',
  other: '<rect x="3.5" y="3.5" width="9" height="9"/>',
};
const icon = id => `<svg class="fl-ic" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${ICON[id]}</svg>`;
import { isExpert } from './expert.js';
const SKEY = 'tgi-flags-v1';

export function createContam(ctx) {
  const { $, R, V, esc } = ctx;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch { return {}; } })();
  const S = {
    // "Other flag" starts hidden: on Barnard's Star ~70 px per image carry BLOOM/SUR_ERROR/PERSIST
    // and their outlines bury the picture. One switch in the legend turns them on.
    layer: 'image', show: Object.assign(Object.fromEntries(KINDS.map(k => [k.id, k.id !== 'other'])), saved.show || {}),
    hide: new Set(saved.hide || []), job: null, done: 0, total: 0,
  };
  const persist = () => { try { localStorage.setItem(SKEY, JSON.stringify({ show: S.show, hide: [...S.hide] })); } catch { /* private mode */ } };

  /* ----- per-frame summaries ----- */
  // classifyFrame (core/contam.js): real hits within CORE_PX of the star, saturated core, airglow
  const cls = raw => raw._cls || (raw._cls = classifyFrame({ flags: raw.flags, flagNames: raw.flagNames, n: V.n,
    cx: (raw.expected || [V.grid.c])[0], cy: (raw.expected || [0, V.grid.c])[1], glow: raw.glow }));
  const summary = f => (f.raw ? cls(f.raw) : { hits: {} });
  const hideSet = () => new Set([...S.hide].filter(id => HIDE_IDS.includes(id)));
  const filter = FA => visibleFrames(FA, hideSet(), summary);
  const whyHidden = f => (f?.raw ? hideReason(cls(f.raw), hideSet()) : null);

  /* ----- layers ----- */
  function stackLayer(s) {
    const key = '_SL_' + S.layer; if (key in s) return s[key];
    const k = V.stacks.indexOf(s), raws = ctx.stackRaws(), seas = seasons(raws)[k];
    if (!seas) return null;
    if (seas.frames.some(r => r.layers === undefined)) return undefined; // still loading
    const have = seas.frames.filter(r => r.layers?.[S.layer]);
    if (!have.length) return (s[key] = null);
    return (s[key] = stackFrames(have.map(r => ({ n: V.n, data: r.layers[S.layer] }))).data);
  }
  function layerFrame(f) {
    if (S.layer === 'image' || !f) return { f };
    const L = LAYERS[S.layer];
    if (S.layer === 'wave') {
      if (f.det === 'stack') return { f, note: 'WAVE is per image (a stack mixes wavelengths)' };
      const raw = f.raw; if (!raw._wave) raw._wave = waveMap(raw, V.grid, ctx.tables()) || 'none';
      if (raw._wave === 'none') return { f, note: 'WAVE: not in this cutout' };
      return { f, wave: raw._wave, range: layerRange(raw._wave) };
    }
    const arr = f.det === 'stack' ? stackLayer(f) : f.raw?.layers === undefined ? undefined : f.raw.layers[S.layer];
    if (arr === undefined) return { f, note: `${L.label}: loading ${S.done} of ${S.total || '…'}` };
    if (arr === null) return { f, note: f.raw?.layers?.failed ? `${L.label}: IRSA busy, not fetched` : `${L.label}: not in this cutout` };
    const key = '_L_' + S.layer;
    const pf = f[key] || (f[key] = { exp: f.exp, ringOff: f.ringOff, d: Array.from(arr, v => (Number.isFinite(v) ? v : null)), range: layerRange(arr) });
    return { f: pf, ramp: 'copper', range: pf.range, unit: unitText(f.raw?.layers?.units?.[S.layer], S.layer) };
  }
  function unitText(u, layer) { // 'MJy2 / sr2', '(MJy/sr)^2' -> 'MJy²/sr²'
    const t = String(u || (layer === 'variance' ? 'MJy2/sr2' : 'MJy/sr')).replace(/\s+/g, '');
    if (/^\(MJy\/sr\)(\^|\*\*)?2$/i.test(t)) return 'MJy²/sr²';
    return t.replace(/MJy\^?2/gi, 'MJy²').replace(/sr\^?2/gi, 'sr²');
  }
  function drawWave(cv, wave, n, c, o, exp) {
    const g = cv.getContext('2d'); if (cv.width !== n * c || cv.height !== n * c) { cv.width = n * c; cv.height = n * c; } // width OR height
    for (let i = 0; i < n * n; i++) {
      const rg = ctx.rangeOf(wave[i]);
      g.fillStyle = rg ? rg.c : (R.classic?.() === false ? '#1E2A44' : '#3a322b'); g.fillRect((i % n) * c, Math.floor(i / n) * c, c, c);
    }
    if (o.ring && exp) { g.strokeStyle = o.ringColor; g.lineWidth = Math.max(2, c / 8); g.setLineDash([c * 0.5, c * 0.35]); g.beginPath(); g.arc((exp[0] + .5) * c, (exp[1] + .5) * c, 2.2 * c, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
  }

  /* ----- flag marks: one ivory colour, the shape tells the kind (DESIGN.md 23) -----
     Each mark sits in the pixel's top-left corner and takes at most a third of it (1.25 px stroke,
     ivory 85%), so the star stays visible. 6+ touching pixels of one kind: one outline round the
     block and a single mark in its top-left pixel. */
  const MARK = 'rgba(255,246,232,.85)', HALO = 'rgba(11,9,7,.5)';
  function stroke(g, path, lw) { g.lineWidth = lw + 1.5; g.strokeStyle = HALO; path(); g.stroke(); g.lineWidth = lw; g.strokeStyle = MARK; path(); g.stroke(); }
  function mark(g, id, x, y, c, lw) {
    const m = c / 3, i0 = Math.max(1, c * .04), P = (fx, fy) => [x + i0 + fx * (m - i0), y + i0 + fy * (m - i0)];
    if (id === 'cosmic') stroke(g, () => { g.beginPath(); g.moveTo(...P(0, 0)); g.lineTo(...P(1, 1)); g.moveTo(...P(1, 0)); g.lineTo(...P(0, 1)); }, lw);
    else if (id === 'overflow') { g.beginPath(); g.moveTo(...P(0, 0)); g.lineTo(...P(1, 0)); g.lineTo(...P(0, 1)); g.closePath(); g.fillStyle = MARK; g.fill(); g.lineWidth = .75; g.strokeStyle = HALO; g.stroke(); }
    else if (id === 'scatter') for (const t of [.12, .5, .88]) { g.beginPath(); g.arc(...P(t, 1 - t), Math.max(.9, m * .12), 0, Math.PI * 2); g.fillStyle = MARK; g.fill(); }
    else stroke(g, () => { g.beginPath(); g.rect(...P(0, 0), m - i0, m - i0); }, lw * .8);
  }
  // 4-connected blocks of pixels whose first shown kind is the same
  function blocks(kind, n) {
    const seen = new Uint8Array(n * n), out = [];
    for (let i = 0; i < n * n; i++) {
      if (!kind[i] || seen[i]) continue;
      const k = kind[i], cells = [i], q = [i]; seen[i] = 1;
      while (q.length) { const j = q.pop(), x = j % n, y = (j - x) / n;
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) { if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue; const h = ny * n + nx; if (!seen[h] && kind[h] === k) { seen[h] = 1; cells.push(h); q.push(h); } } }
      out.push({ k, cells });
    }
    return out;
  }
  function drawMarks(cv, f, n, c) {
    const raw = f?.raw; if (!raw?.flags) return;
    const g = cv.getContext('2d'), dpr = devicePixelRatio || 1, lw = 1.25 * dpr, tiny = c < 10 * dpr;
    const kind = new Array(n * n), multi = new Uint8Array(n * n);
    // no-data pixels get no marks: they already read as calm flat fill (the hover tip still lists their flags)
    for (let i = 0; i < n * n; i++) { if (f.d?.[i] == null) continue; const ks = pixelKinds(raw.flags[i], raw.masks).filter(id => S.show[id]); if (ks.length) { kind[i] = ks[0]; multi[i] = ks.length > 1; } }
    for (const b of blocks(kind, n)) {
      if (b.cells.length >= 6) {
        const set = new Set(b.cells), path = () => { g.beginPath();
          for (const j of b.cells) { const x = (j % n) * c, y = Math.floor(j / n) * c, X = j % n, Y = Math.floor(j / n);
            if (Y === 0 || !set.has(j - n)) { g.moveTo(x, y); g.lineTo(x + c, y); }
            if (Y === n - 1 || !set.has(j + n)) { g.moveTo(x, y + c); g.lineTo(x + c, y + c); }
            if (X === 0 || !set.has(j - 1)) { g.moveTo(x, y); g.lineTo(x, y + c); }
            if (X === n - 1 || !set.has(j + 1)) { g.moveTo(x + c, y); g.lineTo(x + c, y + c); } } };
        stroke(g, path, lw);
        const tl = Math.min(...b.cells); mark(g, b.k, (tl % n) * c, Math.floor(tl / n) * c, c, lw);
      } else for (const j of b.cells) {
        const x = (j % n) * c, y = Math.floor(j / n) * c;
        if (tiny) { g.fillStyle = MARK; g.fillRect(x, y, Math.max(1, c / 3), Math.max(1, c / 3)); continue; }
        mark(g, b.k, x, y, c, lw);
        if (multi[j]) { g.beginPath(); g.arc(x + c * .14, y + c * .86, .9 * dpr, 0, Math.PI * 2); g.fillStyle = MARK; g.fill(); }
      }
    }
    if (S.show.airglow && raw.glow?.flagged) { // whole-image property: one wave line along the top edge
      const W = n * c, a = Math.max(2, c * .22), y0 = Math.max(6, c * .5), per = Math.max(16, c * 2);
      stroke(g, () => { g.beginPath(); for (let x = 0; x <= W; x += 2) { const y = y0 + a * Math.sin((x / per) * Math.PI * 2); x ? g.lineTo(x, y) : g.moveTo(x, y); } }, lw);
    }
  }

  /* ----- public: draw one canvas (any mode) ----- */
  function drawStage(cv, f, n, o, withMarks) {
    const L = layerFrame(f);
    if (L.wave) drawWave(cv, L.wave, n, o.cell, o, f.ringOff ? null : f.exp);
    else R.draw(cv, L.f, n, L.ramp ? { ...o, ramp: L.ramp } : o);
    if (withMarks && o.hatch !== false && f?.raw) drawMarks(cv, f, n, o.cell);
    cv._shown = { f, marks: !!(withMarks && o.hatch !== false) }; // for the hover tip
    S.last = L; legend(L);
    return L;
  }

  /* ----- stage legend (bottom-left): ramp with low/high + unit, or band swatches ----- */
  const fmt = v => (Math.abs(v) >= 100 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(1) : v.toFixed(Math.abs(v) >= 10 ? 1 : 3));
  function legend(L) {
    const el = $('layerLgd'); if (!el) return;
    if (S.layer === 'image') { el.hidden = true; return; }
    el.hidden = false;
    if (L.note) { el.innerHTML = `<span>${esc(L.note)}</span>`; return; }
    if (L.wave) {
      const seen = []; for (const v of L.wave) { const rg = ctx.rangeOf(v); if (rg && !seen.includes(rg)) seen.push(rg); }
      el.innerHTML = `${seen.map(r => `<span class="lg-sw"><i style="background:${esc(r.c)}"></i>${esc(r.name)}</span>`).join('') || '<span>outside your bands</span>'}<span>${L.range.lo.toFixed(3)}–${L.range.hi.toFixed(3)} µm</span>`;
      return;
    }
    el.innerHTML = `<span>${fmt(L.range.lo)}</span><i class="lg-ramp" style="background:${R.rampCss('copper')}"></i><span>${fmt(L.range.hi)} ${esc(L.unit)}</span>`;
  }
  const chipLead = () => (S.layer === 'image' ? '' : `<b>${LAYERS[S.layer].label}</b><span class="sep">·</span>`);

  /* ----- lazy VARIANCE + ZODI fetch (only once the user picks those layers) ----- */
  function ensureLayers() {
    if (S.layer !== 'variance' && S.layer !== 'zodi') return;
    if (S.job || !V.grid) return;
    const cur = V.F[ctx.P.i]?.mjd ?? 0;
    const todo = V.FA.filter(f => f.raw.layers === undefined && !f.raw._lf).sort((a, b) => Math.abs(a.mjd - cur) - Math.abs(b.mjd - cur));
    S.total = V.FA.length; S.done = V.FA.filter(f => f.raw.layers !== undefined).length;
    if (!todo.length) return;
    const ctl = new AbortController(), owner = V.ctl; S.job = ctl;
    owner?.signal.addEventListener('abort', () => ctl.abort());
    mapLimit(todo, 6, async (f) => {
      if (ctl.signal.aborted) return;
      f.raw._lf = true;
      try { f.raw.layers = await loadLayers(f.raw, V.grid, { base: ctx.base, signal: ctl.signal }); }
      catch (e) { if (e.name === 'AbortError' || ctl.signal.aborted) { f.raw._lf = false; return; } f.raw.layers = { variance: null, zodi: null, failed: true }; }
      S.done++;
      for (const s of V.stacks) { delete s._SL_variance; delete s._SL_zodi; }
      ctx.redraw();
    }).then(() => { if (S.job === ctl) S.job = null; if (!ctl.signal.aborted) ensureLayers(); });
  }

  function setLayer(id, sound) {
    if (!LAYERS[id] || S.layer === id) return;
    S.layer = id;
    ctx.segSelect($('layerSeg'), b => b.dataset.layer === id);
    if (sound) ctx.Snd.play('click');
    const sc = $('screens');
    if (!ctx.set.motion) { sc.classList.remove('lfade'); void sc.offsetWidth; sc.classList.add('lfade'); }
    ensureLayers(); ctx.redraw(); info(V.F[ctx.P.i]);
  }
  $('layerSeg').querySelectorAll('[data-layer]').forEach(b => { b.onclick = () => { if (!b.disabled) setLayer(b.dataset.layer, true); }; });

  /* ----- info panel + key availability ----- */
  function info(f) {
    const raw = f?.raw, L = LAYERS[S.layer];
    const el = $('d-layer');
    if (el) {
      el.hidden = S.layer === 'image';
      el.innerHTML = `<span class="t-mini ${L.tag === 'calc' ? 't-calc' : 't-obs'}">${L.tag === 'calc' ? 'Computed' : 'Observed'}</span> <b>${L.label}</b>: ${esc(L.tip)}${S.layer === 'zodi' ? '. Model made by the archive, not a measurement.' : '.'}`;
    }
    const tables = ctx.tables();
    const wb = $('layerSeg').querySelector('[data-layer=wave]');
    const waveOk = !!(tables && (!raw || (tables[String(raw.detector)] && Number.isFinite(raw.cut?.W?.CRPIX1W))));
    wb.disabled = !waveOk && S.layer !== 'wave'; wb.title = waveOk ? LAYERS.wave.tip : 'Not in this cutout';
    for (const id of ['variance', 'zodi']) {
      const b = $('layerSeg').querySelector(`[data-layer=${id}]`), missing = raw?.layers && !raw.layers.failed && raw.layers[id] === null;
      b.disabled = missing && S.layer !== id; b.title = missing ? 'Not in this cutout' : LAYERS[id].tip;
    }
  }

  /* ----- FLAGS legend + filter popover ----- */
  const kindName = id => KINDS.find(k => k.id === id).name;
  function present() { // kinds the loaded data can show at all (real bits, or the airglow keywords)
    const ids = new Set();
    for (const f of V.FA) {
      for (const k of KINDS) if (k.frame ? (f.raw.glow?.known || f.raw.glow?.nearHe) : f.raw.masks?.[k.id]) ids.add(k.id);
    }
    return KINDS.filter(k => ids.has(k.id));
  }
  function renderPop() {
    const a = document.activeElement, refocus = a?.dataset?.show ? `[data-show=${a.dataset.show}]` : a?.dataset?.hide ? `[data-hide=${a.dataset.hide}]` : null;
    renderPopInner();
    if (refocus) $('flagsPop').querySelector(refocus)?.focus();
  }
  function renderPopInner() {
    const f = V.F[ctx.P.i], raw = f?.raw, c = raw ? countKinds(raw.flags, raw.masks, raw.data) : null;
    const kinds = present();
    const val = k => !raw ? '–' : k.frame ? (raw.glow?.flagged ? 'whole image' : 'none') : `${c[k.id]} px`;
    const any = raw && kinds.some(k => (k.frame ? raw.glow?.flagged : c[k.id] > 0));
    $('flRows').innerHTML = (raw && !any ? '<p class="fl-empty">No flagged pixels in this image.</p>' : '') + kinds.map(k => `
      <div class="fl-row"><span class="fl-mk">${icon(k.id)}</span><span class="fl-txt"><b>${esc(k.name)}</b><small>${esc(k.meaning)}</small></span>
      <span class="fl-n num">${val(k)}</span><button class="switch well" role="switch" aria-checked="${!!S.show[k.id]}" data-show="${k.id}" aria-label="Show ${esc(k.name)} marks"><i></i></button></div>`).join('');
    const nAff = id => V.FA.filter(x => frameHas(summary(x), id)).length;
    const hk = HIDE_KINDS.filter(k => V.FA.some(f => k.frame ? (f.raw.glow?.known || f.raw.glow?.nearHe) : bitsNamed(f.raw.flagNames, k.bits)));
    const hid = V.FA.filter(f => !V.FK.includes(f)), sat = V.FA.filter(f => summary(f).saturated).length; // V.FK: the flag filter alone (V.F also leaves out other bands while one is held)
    const d = f => R.fmtDate(f.date);
    const pop = $('flagsPop'), h3 = pop.querySelector('h3'), foot = pop.querySelector('.foot');
    if (h3) h3.hidden = true; // the section title lives in the <summary> below
    if (foot) foot.textContent = `Flags come from the archive's own quality mask for each image. "Touch the star" = within ${CORE_PX} pixels (~${Math.round(CORE_PX * 6.15)}″) of where it should be.`;
    const wasOpen = !!$('flHide').querySelector('details')?.open;
    $('flHide').innerHTML = `<details class="fl-sec"${wasOpen ? ' open' : ''}><summary>Hide images where these touch the star${hideSet().size ? ` <span class="num">· ${hid.length} hidden</span>` : ''}</summary>` + hk.map(k => `<label class="fl-hide"><input type="checkbox" data-hide="${k.id}" ${S.hide.has(k.id) ? 'checked' : ''}> ${esc(k.name)} <span class="num">${nAff(k.id)} of ${V.FA.length}</span></label>`).join('')
      + `<p class="fl-note">Counts only hits within ${CORE_PX} pixels of the star.${sat ? ` ${sat} image${sat === 1 ? ' has' : 's have'} a saturated core (the star filled its own pixels): shown, not hidden.` : ''}</p>`
      + (hideSet().size ? `<p class="fl-hidden num">${hid.length} image${hid.length === 1 ? '' : 's'} hidden</p>` : '')
      + (hid.length ? `<ul class="fl-why">${hid.map(f => `<li title="${esc(whyHidden(f) || '')}"><span class="num">${d(f)}</span> ${esc(whyHidden(f) || '')}</li>`).join('')}</ul>` : '') + '</details>';
    $('flRows').querySelectorAll('[data-show]').forEach(b => { b.onclick = () => { const id = b.dataset.show; S.show[id] = !S.show[id]; persist(); ctx.Snd.play('click'); ctx.redraw(); renderPop(); }; });
    $('flHide').querySelectorAll('[data-hide]').forEach(cb => { cb.onchange = () => { const id = cb.dataset.hide; cb.checked ? S.hide.add(id) : S.hide.delete(id); persist(); ctx.Snd.play('click'); ctx.refilter(); renderPop(); }; });
  }
  $('flZodi').onclick = () => { setLayer('zodi', true); ctx.closePop(); };

  /* ----- pixel tooltip: "No SPHEREx image here" on no-data pixels (any view, FLAGS on or off),
     plus every flag on the pixel when the FLAGS marks are shown. Quiet in Clean blink. ----- */
  const NO_DATA_TIP = 'No SPHEREx image here';
  function pixelTip(cv, e) {
    const sh = cv._shown, f = sh?.f, n = V.n;
    if (!f?.d || $('stage')?.classList.contains('clean-blink') || ctx.mode() === 'telescopes') return ctx.hideTip();
    const r = cv.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * n), y = Math.floor((e.clientY - r.top) / r.height * n);
    if (x < 0 || y < 0 || x >= n || y >= n) return ctx.hideTip();
    const i = y * n + x, empty = f.d[i] == null;
    const ks = sh.marks && f.raw?.flags ? pixelKinds(f.raw.flags[i], f.raw.masks) : [];
    if (!ks.length && !empty) return ctx.hideTip();
    // archive flag bit names and pixel numbers are Expert detail; Simple keeps the plain kind names
    const bits = f.raw?.flags && isExpert() ? flagNamesOf(f.raw.flags[i], f.raw.flagNames).join(', ') : '';
    const head = empty ? NO_DATA_TIP : ks.map(kindName).join(' · ');
    const why = empty ? (f.det === 'stack' ? 'no data in this season stack' : 'no data in this image') : bits;
    const more = empty && ks.length ? ` · ${ks.map(kindName).join(', ')}` : '';
    const small = [why + more, isExpert() ? `pixel ${x + 1}, ${y + 1}` : ''].filter(Boolean).join(' · ');
    ctx.tipAt(`<b>${esc(head)}</b>${small ? `<small>${esc(small)}</small>` : ''}`, e.clientX, e.clientY);
  }
  for (const id of ['cvA', 'cvB']) {
    const cv = $(id); if (!cv) continue;
    cv.addEventListener('pointermove', e => pixelTip(cv, e));
    cv.addEventListener('pointerleave', () => ctx.hideTip());
  }

  return {
    clearHide() { S.hide.clear(); persist(); }, // "Use all images (as on Proof)"
    S, filter, whyHidden, drawStage, chipLead, info, renderPop, ensureLayers, setLayer,
    flaggedText(f) { // "Flagged pixels 23 of 625" + breakdown for the title
      const raw = f?.raw; if (!raw) return null;
      const c = countKinds(raw.flags, raw.masks, raw.data);
      const parts = [`no data ${c.nodata}`, ...KINDS.filter(k => !k.frame).map(k => `${k.name.toLowerCase()} ${c[k.id]}`), `airglow ${raw.glow?.flagged ? 'yes (' + raw.glow.reasons.join(', ') + ')' : 'no'}${raw.glow?.nearHe ? ' · wavelength near 1.083 µm (information)' : ''}`];
      return { text: `${c.flagged} of ${V.n * V.n}`, title: parts.join(' · ') };
    },
    reset() { S.job?.abort(); S.job = null; S.done = 0; S.total = 0; },
  };
}
