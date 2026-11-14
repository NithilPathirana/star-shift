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
    const pf = f[key] || (f[key] = { exp: f.exp, d: Array.from(arr, v => (Number.isFinite(v) ? v : null)), range: layerRange(arr) });
    return { f: pf, ramp: 'copper', range: pf.range, unit: (f.raw?.layers?.units?.[S.layer] || (S.layer === 'variance' ? 'MJy2 / sr2' : 'MJy / sr')).replace(/\s+/g, '') };
  }
  function drawWave(cv, wave, n, c, o, exp) {
    const g = cv.getContext('2d'); if (cv.width !== n * c) { cv.width = n * c; cv.height = n * c; }
    for (let i = 0; i < n * n; i++) {
      const rg = ctx.rangeOf(wave[i]);
      g.fillStyle = rg ? rg.c : '#3a322b'; g.fillRect((i % n) * c, Math.floor(i / n) * c, c, c);
    }
    if (o.ring && exp) { g.strokeStyle = o.ringColor; g.lineWidth = Math.max(2, c / 8); g.setLineDash([c * 0.5, c * 0.35]); g.beginPath(); g.arc((exp[0] + .5) * c, (exp[1] + .5) * c, 2.2 * c, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
  }

  /* ----- flag marks: one ivory colour, the shape tells the kind ----- */
  function stroke(g, path, lw) { g.lineWidth = lw + 2; g.strokeStyle = UNDER; path(); g.stroke(); g.lineWidth = lw; g.strokeStyle = IVORY; path(); g.stroke(); }
  function mark(g, id, x, y, c, lw) {
    const P = (fx, fy) => [x + fx * c, y + fy * c];
    if (id === 'cosmic') stroke(g, () => { g.beginPath(); g.moveTo(...P(.28, .28)); g.lineTo(...P(.72, .72)); g.moveTo(...P(.72, .28)); g.lineTo(...P(.28, .72)); }, lw);
    else if (id === 'overflow') { g.beginPath(); g.moveTo(...P(.58, 0)); g.lineTo(...P(1, 0)); g.lineTo(...P(1, .42)); g.closePath(); g.fillStyle = IVORY; g.fill(); g.lineWidth = 1; g.strokeStyle = UNDER; g.stroke(); }
    else if (id === 'scatter') for (const t of [.25, .5, .75]) { g.beginPath(); g.arc(...P(t, 1 - t), Math.max(1.2, c * .07), 0, Math.PI * 2); g.fillStyle = IVORY; g.fill(); g.lineWidth = 1; g.strokeStyle = UNDER; g.stroke(); }
    else stroke(g, () => { g.beginPath(); g.rect(...P(.12, .12), c * .76, c * .76); }, Math.max(1, lw * .7));
  }
  function drawMarks(cv, f, n, c) {
    const raw = f?.raw; if (!raw?.flags) return;
    const g = cv.getContext('2d'), dpr = devicePixelRatio || 1, lw = 1.5 * dpr, tiny = c < 10 * dpr;
    for (let i = 0; i < n * n; i++) {
      const ks = pixelKinds(raw.flags[i], raw.masks).filter(id => S.show[id]); if (!ks.length) continue;
      const x = (i % n) * c, y = Math.floor(i / n) * c;
      if (tiny) { mark(g, 'other', x, y, c, 1); continue; }
      mark(g, ks[0], x, y, c, lw);
      if (ks.length > 1) { g.beginPath(); g.arc(x + c * .14, y + c * .86, dpr, 0, Math.PI * 2); g.fillStyle = IVORY; g.fill(); }
    }
    if (S.show.airglow && raw.glow?.flagged) { // whole-image property: one wave line along the top edge
      const W = n * c, a = Math.max(2, c * .22), y0 = Math.max(6, c * .5), per = Math.max(16, c * 2);
      stroke(g, () => { g.beginPath(); for (let x = 0; x <= W; x += 2) { const y = y0 + a * Math.sin((x / per) * Math.PI * 2); x ? g.lineTo(x, y) : g.moveTo(x, y); } }, lw);
    }
  }

  /* ----- public: draw one canvas (any mode) ----- */
  function drawStage(cv, f, n, o, withMarks) {
    const L = layerFrame(f);
    if (L.wave) drawWave(cv, L.wave, n, o.cell, o, f.exp);
    else R.draw(cv, L.f, n, L.ramp ? { ...o, ramp: L.ramp } : o);
    if (withMarks && o.hatch !== false && f?.raw) drawMarks(cv, f, n, o.cell);
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
    const waveOk = !!(tables && (!raw || (tables[String(raw.detector)] && raw.cut?.W?.CRPIX1W)));
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
    const hid = V.FA.filter(f => !V.F.includes(f)), sat = V.FA.filter(f => summary(f).saturated).length;
    const d = f => R.fmtDate(f.date);
    $('flHide').innerHTML = hk.map(k => `<label class="fl-hide"><input type="checkbox" data-hide="${k.id}" ${S.hide.has(k.id) ? 'checked' : ''}> ${esc(k.name)} <span class="num">${nAff(k.id)} of ${V.FA.length}</span></label>`).join('')
      + `<p class="fl-note">Counts only hits within ${CORE_PX} pixels of the star.${sat ? ` ${sat} image${sat === 1 ? ' has' : 's have'} a saturated core (the star filled its own pixels): shown, not hidden.` : ''}</p>`
      + (hideSet().size ? `<p class="fl-hidden num">${hid.length} image${hid.length === 1 ? '' : 's'} hidden</p>` : '')
      + (hid.length ? `<ul class="fl-why">${hid.map(f => `<li title="${esc(whyHidden(f) || '')}"><span class="num">${d(f)}</span> ${esc(whyHidden(f) || '')}</li>`).join('')}</ul>` : '');
    $('flRows').querySelectorAll('[data-show]').forEach(b => { b.onclick = () => { const id = b.dataset.show; S.show[id] = !S.show[id]; persist(); ctx.Snd.play('click'); ctx.redraw(); renderPop(); }; });
    $('flHide').querySelectorAll('[data-hide]').forEach(cb => { cb.onchange = () => { const id = cb.dataset.hide; cb.checked ? S.hide.add(id) : S.hide.delete(id); persist(); ctx.Snd.play('click'); ctx.refilter(); renderPop(); }; });
  }
  $('flZodi').onclick = () => { setLayer('zodi', true); ctx.closePop(); };

  /* ----- pixel tooltip: lists every flag on the pixel under the pointer ----- */
  const cvA = $('cvA');
  cvA.addEventListener('pointermove', e => {
    const f = V.F[ctx.P.i];
    if (ctx.mode() !== 'play' || !f?.raw?.flags || !ctx.set.hatch) return ctx.hideTip();
    const r = cvA.getBoundingClientRect(), n = V.n, x = Math.floor((e.clientX - r.left) / r.width * n), y = Math.floor((e.clientY - r.top) / r.height * n);
    if (x < 0 || y < 0 || x >= n || y >= n) return ctx.hideTip();
    const i = y * n + x, ks = pixelKinds(f.raw.flags[i], f.raw.masks), empty = f.d[i] == null;
    if (!ks.length && !empty) return ctx.hideTip();
    const names = [...(empty ? ['No data'] : []), ...ks.map(kindName)];
    ctx.tipAt(`<b>${esc(names.join(' · '))}</b><small>${esc(flagNamesOf(f.raw.flags[i], f.raw.flagNames).join(', ') || 'masked')} · pixel ${x + 1}, ${y + 1}</small>`, e.clientX, e.clientY);
  });
  cvA.addEventListener('pointerleave', () => ctx.hideTip());

  return {
    S, filter, whyHidden, drawStage, chipLead, info, renderPop, ensureLayers, setLayer,
    flaggedText(f) { // "Flagged pixels 23 of 625" + breakdown for the title
      const raw = f?.raw; if (!raw) return null;
      const c = countKinds(raw.flags, raw.masks, raw.data);
      const parts = [`no data ${c.nodata}`, ...KINDS.filter(k => !k.frame).map(k => `${k.name.toLowerCase()} ${c[k.id]}`), `airglow ${raw.glow?.flagged ? 'yes (' + raw.glow.reasons.join(', ') + ')' : 'no'}`];
      return { text: `${c.flagged} of ${V.n * V.n}`, title: parts.join(' · ') };
    },
    reset() { S.job?.abort(); S.job = null; S.done = 0; S.total = 0; },
  };
}
