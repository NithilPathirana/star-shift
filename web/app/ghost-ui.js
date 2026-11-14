// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// The Ghost (team feature C, DESIGN.md section 24): a hollow ivory ring + dotted trail showing
// where the star was or will be, on the time-lapse canvas (Time view) and on the 3D sky map.
// Motion source: the 5 built-in targets use their catalogue values (SIMBAD, presets.js);
// any other star is matched in Gaia DR3 through our relay; SIMBAD values are the fallback.
// Straight-line proper motion only (no parallax wobble, no change in speed).

import { gaiaCone } from '../core/resolve.js';
import { propagate, epochYearToMjd } from '../core/motion.js';
import { worldToGrid } from '../core/align.js';
import { hasMotion, ghostRange, ghostTrail, moved, ghostLabel, fmtArc, pickGaia } from '../core/ghost.js';

const IV = a => `rgba(255,246,232,${a})`;
const fmtYr = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US')} yr`;

export function createGhost(ctx) {
  const { $, V, esc } = ctx;
  const G = { on: false, years: 0, star: null, mapStar: null, alpha: 1, cache: new Map(), vKey: null, mKey: null };
  const endpoint = `${location.origin}/gaia/tap/sync`;

  /* ----- which star, and from which catalogue ----- */
  async function resolveStar(cat, ra, dec, key) {
    if (G.cache.has(key)) return G.cache.get(key);
    let out = null;
    if (cat?.preset) out = { ...cat.preset, source: 'SIMBAD (built-in values for this NASA target)' };
    else {
      try {
        const named = hasMotion(cat);
        const want = named ? propagate(cat, epochYearToMjd(2016)) : { ra, dec };
        const r = named ? 5 : 8;
        const rows = await gaiaCone(want.ra, want.dec, r, { endpoint, top: 20, signal: AbortSignal.timeout(15000) });
        const g = pickGaia(rows, want, r, named ? 'nearest' : 'brightest');
        if (g) out = { ra: g.ra, dec: g.dec, pmra: g.pmra, pmdec: g.pmdec, epoch: 2016, source: g.id, g: g.g,
          plx: g.plx, plxErr: g.plxErr, pmraErr: g.pmraErr, pmdecErr: g.pmdecErr, rv: g.rv, rvErr: g.rvErr, gaia: true }; // extra fields: Motion panel (27)
      } catch { /* Gaia not answering: fall back below */ }
      if (!out && hasMotion(cat)) out = { ...cat, source: 'SIMBAD' };
    }
    G.cache.set(key, out);
    return out;
  }

  /* ----- viewer: rail key, slider strip, canvas drawing ----- */
  const key = $('ghostKey'), bar = $('ghostBar'), rng = $('ghRange');
  function setRange(star) {
    const { half, step } = ghostRange(star || {});
    for (const r of [rng, $('cdGhRange')]) { if (!r) continue; r.min = -half; r.max = half; r.step = step; r.value = 0; }
    $('ghMin').textContent = fmtYr(-half); $('ghMax').textContent = fmtYr(half);
    G.years = 0; G.step = step;
  }
  function syncKey() {
    const ok = !!G.star;
    key.disabled = !ok; key.title = ok ? 'Ghost: predicted past and future position' : (G.vKey && !G.cache.has(G.vKey) ? 'Looking up the motion…' : 'No catalogued motion for this object');
    key.setAttribute('aria-pressed', G.on && ok);
    bar.hidden = !(G.on && ok && ctx.scene() === 'viewer' && ctx.mode() === 'play');
  }
  async function forTarget(t) {
    G.star = null; const k = t ? (t.presetKey ? 'p:' + t.presetKey : `v:${t.ra.toFixed(5)},${t.dec.toFixed(5)}`) : null; G.vKey = k; syncKey(); update();
    if (!t) return;
    const preset = t.presetKey ? t : null;
    const s = await resolveStar(preset ? { preset: t } : t, t.ra, t.dec, k);
    if (G.vKey !== k) return;
    G.star = s; setRange(s); applyPending(true); syncKey(); update(); ctx.redraw();
  }
  // Shareable link: &ghost=<years> opens with the Ghost on at that offset (viewer or map).
  function applyPending(viewer) {
    const p = G.pending; if (!p || p.viewer !== viewer) return;
    G.pending = null; G.on = true;
    const half = viewer ? +rng.max : ghostRange(G.mapStar || {}).half, v = Math.max(-half, Math.min(half, p.years));
    G.years = v; rng.value = v; if ($('cdGhRange')) $('cdGhRange').value = v;
  }
  function toggle(on) {
    G.on = on ?? !G.on; ctx.Snd.play('click');
    if (G.on && !ctx.set.motion) { const t0 = performance.now(); const k = () => { G.alpha = Math.min(1, (performance.now() - t0) / 180); ctx.redraw(); placeMap(); if (G.alpha < 1) requestAnimationFrame(k); }; G.alpha = 0; requestAnimationFrame(k); } else G.alpha = 1;
    syncKey(); renderCD(); update(); ctx.redraw(); placeMap();
  }
  key.onclick = () => { if (!key.disabled) toggle(); };
  let lastSnd = 0;
  function setYears(v, from) {
    G.years = +v; if (rng !== from) rng.value = v; const cr = $('cdGhRange'); if (cr && cr !== from) cr.value = v;
    if (performance.now() - lastSnd > 90) { ctx.Snd.play('scrub'); lastSnd = performance.now(); }
    update(); ctx.redraw(); placeMap();
  }
  function sliderKeys(e) { // Shift+arrows = ten steps, Home = the image's date (or now on the map)
    const st = +e.target.step || 1;
    if (e.key === 'Home') { e.preventDefault(); setYears(0, null); }
    else if (e.shiftKey && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
      e.preventDefault(); const d = /Left|Down/.test(e.key) ? -10 * st : 10 * st;
      setYears(Math.max(+e.target.min, Math.min(+e.target.max, G.years + d)), null);
    }
  }
  rng.addEventListener('input', () => setYears(rng.value, rng)); rng.addEventListener('keydown', sliderKeys);
  $('ghReset').onclick = () => { setYears(0, null); ctx.Snd.play('click'); };

  const curFrame = () => V.F[Math.min(ctx.P.i, V.F.length - 1)];
  function update() { // readout + info rows (viewer)
    const f = curFrame(), info = $('ghInfo');
    if (!G.star || !f || !G.on) { info.hidden = true; return; }
    const mv = moved(G.star, f.mjd, G.years);
    $('ghRead').textContent = `${ghostLabel(f.mjd, G.years)} · moved ${fmtArc(mv.arcsec)}`;
    rng.setAttribute('aria-valuetext', `${ghostLabel(f.mjd, G.years)}, moved ${fmtArc(mv.arcsec)} ${mv.dir}`);
    info.hidden = false;
    info.innerHTML = `<p class="note">Ghost: predicted from the catalogue's proper motion in a straight line. It leaves out the yearly parallax wobble and any change in speed. Ring size is fixed (catalogue errors not drawn).</p>
      <dl><dt>Ghost date <span class="t-mini t-calc">Computed</span></dt><dd>${esc(ghostLabel(f.mjd, G.years))}</dd>
      <dt>Moved since this image <span class="t-mini t-calc">Computed</span></dt><dd>${fmtArc(mv.arcsec)} ${mv.arcsec > 0.05 ? mv.dir : ''}</dd>
      <dt>Motion from <span class="t-mini t-cat">Catalogue</span></dt><dd>${esc(G.star.source)}</dd></dl>`;
  }

  function drawCanvas(cv, f, c) {
    const off = $('ghostOff');
    if (!G.on || !G.star || !f || !V.grid || ctx.mode() !== 'play' || f.det === 'stack') { off.hidden = true; return; }
    const g = cv.getContext('2d'), dpr = devicePixelRatio || 1, n = V.n, W = n * c, a = G.alpha;
    const xy = p => { const [x, y] = worldToGrid(V.grid, p.ra, p.dec); return [(x + 0.5) * c, (y + 0.5) * c]; };
    const tr = ghostTrail(G.star, f.mjd, G.years, 60), P = tr.pts.map(xy), [gx, gy] = P[P.length - 1];
    g.save();
    // dotted trail with an under-stroke so it reads on bright pixels
    g.lineCap = 'round';
    for (const [w, col] of [[2.6 * dpr, `rgba(11,9,7,${0.55 * a})`], [1 * dpr, IV(0.9 * a)]]) {
      g.setLineDash([2 * dpr, 4 * dpr]); g.lineWidth = w; g.strokeStyle = col; g.beginPath(); P.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    }
    g.setLineDash([]);
    // ticks across the trail every year / decade / century
    const [x0, y0] = P[0], len = Math.hypot(gx - x0, gy - y0) || 1, nx = -(gy - y0) / len, ny = (gx - x0) / len;
    g.lineWidth = 1 * dpr; g.strokeStyle = IV(0.85 * a);
    for (const t of tr.ticks) { const [x, y] = xy(t); g.beginPath(); g.moveTo(x - nx * 3 * dpr, y - ny * 3 * dpr); g.lineTo(x + nx * 3 * dpr, y + ny * 3 * dpr); g.stroke(); }
    // the Ghost: hollow ivory ring with a soft halo, never a filled dot
    const R = 2.2 * c;
    g.lineWidth = 6 * dpr; g.strokeStyle = IV(0.18 * a); g.beginPath(); g.arc(gx, gy, R, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.5 * dpr; g.strokeStyle = IV(0.8 * a); g.beginPath(); g.arc(gx, gy, R, 0, Math.PI * 2); g.stroke();
    const inside = gx >= -R && gy >= -R && gx <= W + R && gy <= W + R;
    // label: "2051 · +25 yr · Predicted" (on the picture only; off it, the edge chip says it)
    if (inside) {
    const lab = `${ghostLabel(f.mjd, G.years)} · Predicted`;
    g.font = `500 ${11 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
    const tw = g.measureText(lab).width, pad = 5 * dpr, lh = 18 * dpr;
    // the part of the canvas the stage really shows (on a phone the canvas can be wider than the stage)
    const cr0 = cv.getBoundingClientRect(), st0 = $('stage').getBoundingClientRect(), k0 = cr0.width / W || 1;
    const vx0 = Math.max(0, (st0.left - cr0.left) / k0), vx1 = Math.min(W, (st0.right - cr0.left) / k0);
    const vy0 = Math.max(0, (st0.top - cr0.top) / k0), vy1 = Math.min(W, (st0.bottom - cr0.top) / k0);
    let lx = gx + R + 6 * dpr, ly = gy - lh / 2;
    if (lx + tw + 2 * pad > vx1 - 4 * dpr) lx = gx - R - 6 * dpr - tw - 2 * pad; // flip to the ring's other side
    if (lx < vx0 + 4 * dpr) { // fits on neither side: centre it under (or over) the ring, inside the visible part
      lx = Math.max(vx0 + 4 * dpr, Math.min(vx1 - 4 * dpr - tw - 2 * pad, gx - (tw + 2 * pad) / 2));
      ly = gy + R + 6 * dpr + lh <= vy1 - 2 ? gy + R + 6 * dpr : gy - R - 6 * dpr - lh;
    }
    ly = Math.max(vy0 + 2, Math.min(vy1 - lh - 2, ly));
    g.fillStyle = `rgba(21,17,14,${0.82 * a})`; g.beginPath(); g.roundRect ? g.roundRect(lx, ly, tw + 2 * pad, lh, 9 * dpr) : g.rect(lx, ly, tw + 2 * pad, lh); g.fill();
    g.fillStyle = IV(0.95 * a); g.textBaseline = 'middle'; g.fillText(lab, lx + pad, ly + lh / 2 + 0.5);
    }
    g.restore();
    // off the picture: a chip pinned to the nearest stage edge, with an arrow
    off.hidden = inside; if (inside) return;
    const cr = cv.getBoundingClientRect(), st = $('stage').getBoundingClientRect(), k = cr.width / W;
    const cx = cr.left + cr.width / 2 - st.left, cy = cr.top + cr.height / 2 - st.top;
    const dx = gx * k + cr.left - st.left - cx, dy = gy * k + cr.top - st.top - cy;
    // 10 px further in than before so the chip stays off the airglow wave along the top edge
    const s = Math.min((st.width / 2 - 130) / Math.abs(dx || 1e-9), (st.height / 2 - (dy > 0 && !bar.hidden ? 130 : 80)) / Math.abs(dy || 1e-9));
    const mv = moved(G.star, f.mjd, G.years);
    off.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" style="transform:rotate(${Math.atan2(dy, dx)}rad)" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span>Predicted: off the image · ${fmtArc(mv.arcsec)} ${mv.dir}</span>`;
    off.style.left = (cx + dx * s) + 'px'; off.style.top = (cy + dy * s) + 'px';
  }

  /* ----- map: trail + ring on the 3D sky, and the slider in the coordinate panel ----- */
  async function forSelection(sel) {
    G.mapStar = null; const t = sel?.t;
    const k = t?.preset ? 'p:' + t.preset.key : sel ? `m:${sel.ra.toFixed(5)},${sel.dec.toFixed(5)}` : null; G.mKey = k;
    renderCD(); placeMap();
    if (!sel) return;
    const cat = t?.preset ? { preset: { ...t.preset.target, presetKey: t.preset.key } } : t?.simbad || null;
    const s = await (G.mStar = resolveStar(cat, sel.ra, sel.dec, k)); // G.mStar: shared with the Motion panel
    if (G.mKey !== k) return;
    G.mapStar = s; if (!G.star) setRange(s); else { const r = $('cdGhRange'); if (r) { const { half, step } = ghostRange(s || {}); r.min = -half; r.max = half; r.step = step; r.value = Math.max(-half, Math.min(half, G.years)); } }
    applyPending(false); renderCD(); placeMap();
  }
  function renderCD() {
    const el = $('cdGhost'); if (!el) return;
    const s = G.mapStar;
    if (!s) { el.innerHTML = `<p class="quiet">${G.mKey && !G.cache.has(G.mKey) ? 'Looking up the motion in Gaia DR3…' : 'No catalogued motion for this object, so no Ghost.'}</p>`; return; }
    const { half, step } = ghostRange(s);
    el.innerHTML = `<div class="obs-row"><span id="cdGhLbl">Show the Ghost on the sky</span><button class="switch well" role="switch" aria-checked="${G.on}" id="cdGhSw" aria-labelledby="cdGhLbl"><i></i></button></div>
      <div class="gh-cd"><span class="num">${fmtYr(-half)}</span><input type="range" id="cdGhRange" min="${-half}" max="${half}" step="${step}" value="${Math.max(-half, Math.min(half, G.years))}" aria-label="Ghost date, years from now" ${G.on ? '' : 'disabled'}><span class="num">${fmtYr(half)}</span></div>
      <p class="gh-cd-read num" id="cdGhRead"></p>
      <p class="quiet">Motion from <span class="t-mini t-cat">Catalogue</span> ${esc(s.source)}. Ghost <span class="t-mini t-calc">Computed</span>: straight-line proper motion from Nov 2026; no parallax wobble, no change in speed.</p>`;
    $('cdGhSw').onclick = () => toggle();
    const r = $('cdGhRange'); r.addEventListener('input', () => setYears(r.value, r)); r.addEventListener('keydown', sliderKeys);
    readCD();
  }
  function readCD() {
    const el = $('cdGhRead'); if (!el || !G.mapStar) return;
    const mv = moved(G.mapStar, ctx.NOW_MJD, G.years);
    el.textContent = `${ghostLabel(ctx.NOW_MJD, G.years)} · moved ${fmtArc(mv.arcsec)} ${mv.arcsec > 0.05 ? mv.dir : ''}`;
  }
  function placeMap() {
    readCD();
    const svg = $('ghMap'); if (!svg) return;
    const s = G.mapStar;
    if (!G.on || !s || ctx.scene() !== 'map' || !ctx.skymap.aladin) { svg.innerHTML = ''; return; }
    const tr = ghostTrail(s, ctx.NOW_MJD, G.years, 48), px = tr.pts.map(p => ctx.skymap.toPix(p.ra, p.dec));
    if (px.some(p => !p)) { svg.innerHTML = ''; return; }
    const [gx, gy] = px[px.length - 1], a = G.alpha;
    const pxPerArcsec = $('mapWrap').clientWidth / (ctx.skymap.fov() * 3600), R = Math.max(9, 13.5 * pxPerArcsec);
    const ticks = tr.ticks.map(t => ctx.skymap.toPix(t.ra, t.dec)).filter(Boolean);
    // label beside the ring; flips to the ring's other side when it would cross the stage edge
    const lw = ghostLabel(ctx.NOW_MJD, G.years).length * 6.8 + 82, Wm = $('mapWrap').clientWidth, Hm = $('mapWrap').clientHeight;
    let lx = gx + R + 6; if (lx + lw > Wm - 8 && gx - R - 6 - lw >= 8) lx = gx - R - 6 - lw;
    const ly = Math.max(17, Math.min(Hm - 17, gy));
    svg.innerHTML = `<g opacity="${a}"><polyline points="${px.map(p => p.join(',')).join(' ')}" fill="none" stroke="rgba(11,9,7,.55)" stroke-width="2.6" stroke-dasharray="2 4" stroke-linecap="round"/>
      <polyline points="${px.map(p => p.join(',')).join(' ')}" fill="none" stroke="${IV(0.9)}" stroke-width="1" stroke-dasharray="2 4" stroke-linecap="round"/>
      ${ticks.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="${IV(0.85)}"/>`).join('')}
      <circle cx="${gx}" cy="${gy}" r="${R}" fill="none" stroke="${IV(0.18)}" stroke-width="6"/><circle cx="${gx}" cy="${gy}" r="${R}" fill="none" stroke="${IV(0.8)}" stroke-width="1.5"/>
      <g class="gh-lab" transform="translate(${lx},${ly})"><rect x="0" y="-9" width="${lw}" height="18" rx="9" fill="rgba(21,17,14,.82)"/><text x="6" y="4" fill="${IV(0.95)}">${esc(ghostLabel(ctx.NOW_MJD, G.years))} · Predicted</text></g></g>`;
  }

  return { G, forTarget, forSelection, drawCanvas, update, placeMap, syncKey, renderCD };
}
