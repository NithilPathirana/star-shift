// Sky3D: the night sky as a real 3D celestial sphere (three.js, self-hosted).
// You stand at the centre: drag to look around (with inertia), wheel/pinch to zoom toward
// the pointer. Real Hipparcos stars (size from V, colour from B-V), the Milky Way from the
// SPHEREx all-sky texture, and SPHEREx HiPS tiles (orders 3-5) fading in below 20° FOV.
// Same public interface as SkyMap (web/app/skymap.js), so it is a one-line swap in ui.js.
// Look: design/DESIGN.md section 18. Renders on demand only (idle canvas when nothing moves).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import * as THREE from '../../vendor/three-0.186.1/three.module.js';
import { pixToVec, tileUV, allskyRect, tilePath, parent, children, npix } from './healpix.js';
import {
  radecToVec, vecToRadec, frame, project, unproject, vfov, viewRadius, chooseOrder, visibleTiles,
  imageryAlpha, starAlpha, detailRamp, magLimit, starColor, pickStar, slerpRadec, easeInOut, panned,
  gridStep, wrap360, wrap180, clampDec, clampFov, MAX_FOV, GESTURE_MIN_FOV,
} from './view.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const BG = 0x0E0B09; // DESIGN.md --stage
const MW_TINT = [0xE9 / 255, 0xD8 / 255, 0xC2 / 255], DETAIL_TINT = [1.0, 0.965, 0.92]; // warm grey
const STARS_URL = new URL('../data/stars.json', import.meta.url);
export const CREDIT = 'Stars: Hipparcos (ESA), new reduction (van Leeuwen 2007), via the ESA Gaia archive. Imagery: NASA/SPHEREx DR1 (Caltech/IPAC).';

const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
const MAX_TEX = COARSE ? 64 : 220;     // 512 px tiles kept on the GPU (LRU)
const MAX_VIS = COARSE ? 48 : 110;     // tiles wanted per view, centre first
const MAX_INFLIGHT = 6, UPLOADS_PER_FRAME = 3, TILE_FADE_MS = 260, MOVE_SETTLE_MS = 350;
const SEG = { 3: 8, 4: 6, 5: 4 };

// ---------- shaders (GLSL3 through three's ShaderMaterial; raw display values, no colour management)
const TILE_VS = `out vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TILE_FS = `out vec4 outColor; uniform sampler2D map; uniform float alpha; uniform float nearest; uniform vec2 texSize; in vec2 vUv;
void main() {
  vec3 c = nearest > 0.5 ? textureLod(map, (floor(vUv * texSize) + 0.5) / texSize, 0.0).rgb : texture(map, vUv).rgb;
  outColor = vec4(c, alpha);
}`;
const COMP_VS = `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COMP_FS = `out vec4 outColor; uniform sampler2D tex; uniform float alpha; uniform vec3 tint; uniform float sat; in vec2 vUv;
void main() {
  vec3 c = texture(tex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  outColor = vec4(mix(vec3(l), c, sat) * tint, alpha);
}`;
const STAR_VS = `uniform float uScale; uniform float uAlpha; uniform float uMagLim;
in vec3 aColor; in float aMag; out vec3 vColor; out float vA; out float vSpan;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  float core = clamp(1.2 + (6.5 - aMag) * 0.85, 1.2, 7.0) * uScale;
  float bright = clamp(pow(pow(10.0, -0.4 * aMag) / pow(10.0, 0.6), 0.35), 0.25, 1.0);
  float fade = clamp(1.0 - (aMag - uMagLim) / 0.4, 0.0, 1.0);
  vSpan = aMag < 2.0 ? 3.0 : 1.4;           // sprite radius in core radii (halo only for V < 2)
  gl_PointSize = core * vSpan;
  vA = bright * uAlpha * fade; vColor = aColor;
  if (vA < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const STAR_FS = `out vec4 outColor; in vec3 vColor; in float vA; in float vSpan;
void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0) * vSpan;  // distance in core radii
  float core = exp(-2.2 * d * d);
  float halo = vSpan > 2.0 ? 0.07 * exp(-1.1 * d) * (1.0 - smoothstep(2.2, 3.0, d)) : 0.0;
  float a = (core + halo) * vA;
  if (a < 0.003) discard;
  outColor = vec4(vColor, a);
}`;
const GRID_VS = `in float aEq; out float vEq; void main() { vEq = aEq; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GRID_FS = `out vec4 outColor; in float vEq; void main() { outColor = vec4(1.0, 0.922, 0.824, vEq > 0.5 ? 0.20 : 0.08); }`;

const mat = (vs, fs, uniforms, extra = {}) => new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3, vertexShader: vs, fragmentShader: fs, uniforms,
  transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, ...extra,
});

// One HEALPix tile as a curved patch on the unit sphere, UVs in HiPS tile orientation.
function patch(order, n, seg, uvOf) {
  const nv = (seg + 1) * (seg + 1), pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  let k = 0;
  for (let i = 0; i <= seg; i++) for (let j = 0; j <= seg; j++, k++) {
    const dx = i / seg, dy = j / seg;
    pos.set(pixToVec(order, n, dx, dy), k * 3);
    uv.set(uvOf(...tileUV(dx, dy)), k * 2);
  }
  const idx = [];
  for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  return { pos, uv, idx };
}
function tileGeometry(order, n) {
  const { pos, uv, idx } = patch(order, n, SEG[order] || 4, (u, v) => [u, v]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
// All 768 order-3 cells, UVs into the Allsky.png atlas (half-pixel inset against bleeding).
function allskyGeometry(W, H) {
  const w = W / 27, seg = 6, per = (seg + 1) * (seg + 1), N = npix(3);
  const pos = new Float32Array(N * per * 3), uv = new Float32Array(N * per * 2), idx = new Uint32Array(N * seg * seg * 6);
  let ii = 0;
  for (let n = 0; n < N; n++) {
    const r = allskyRect(n, w);
    const p = patch(3, n, seg, (u, v) => [(r.x + 0.5 + u * (w - 1)) / W, (r.y + 0.5 + v * (w - 1)) / H]);
    pos.set(p.pos, n * per * 3); uv.set(p.uv, n * per * 2);
    for (const q of p.idx) idx[ii++] = q + n * per;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

async function loadTexture(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const tex = new THREE.Texture(bmp);
  tex.flipY = false; tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
const freeTexture = (tex) => { if (!tex) return; tex.dispose(); tex.image?.close?.(); };

export class Sky3D {
  constructor(el, { onClick, onHover, onMove, onView } = {}) {
    this.el = el; this.onClick = onClick; this.onHover = onHover; this.onMove = onMove; this.onView = onView;
    this.channel = 33; // 1.63 µm: stars bright, low noise
    this.ready = null; this.aladin = null; this.credit = CREDIT;
    this.v = { ra: 0, dec: 0, fov: 60 };
    this.bandSpec = []; this.gridOn = false; this.stats = { frames: 0, renders: 0, lastMs: 0 };
  }

  // ---------------- public interface (same as SkyMap) ----------------
  init(ra, dec, fovDeg = 60) {
    if (this.ready) return this.ready;
    this.ready = this._init(ra, dec, fovDeg);
    return this.ready;
  }
  center() { return { ra: this.v.ra, dec: this.v.dec }; }
  fov() { return this.v.fov; }
  toPix(ra, dec) { const p = project(this._view(), radecToVec(ra, dec)); return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null; }
  toWorld(x, y) { if (!(this.w > 0)) return null; return vecToRadec(unproject(this._view(), x, y)); }
  setFov(deg) {
    if (this.anim) { this.anim.to.fov = clampFov(deg); return; }
    this.v.fov = clampFov(deg); this._changed();
  }
  panBy(fx, fy) { // fractions of the view; +x = towards east (left on screen), +y = north
    if (this.anim) { Object.assign(this.anim.to, panned({ ...this.anim.to }, fx, fy)); return; }
    Object.assign(this.v, panned(this.v, fx, fy)); this._changed();
  }
  goTo(ra, dec, fovDeg) {
    const to = { ra: wrap360(+ra), dec: clampDec(+dec), fov: fovDeg ? clampFov(fovDeg) : this.v.fov };
    if (!Number.isFinite(to.ra) || !Number.isFinite(to.dec)) return;
    this.inertia = null; this.zoomAnim = null;
    if (this._reduced() || !this.renderer) { this.anim = null; Object.assign(this.v, to); this._changed(); return; }
    this.anim = { from: { ...this.v }, to, t0: performance.now(), dur: 900 };
    this._kick();
  }
  setChannel(ch) {
    this.channel = ch;
    if (!this.renderer) return;
    this._updateWanted(); this._kick();
  }
  setBands(bands) { // [{ channels: [..], color: 'rrggbb' }]: tinted channels added together on black
    this.bandSpec = (bands || []).flatMap(b => (b.channels || []).map(ch => ({ ch, color: String(b.color || 'ffffff').replace('#', ''), w: 1 / Math.max(1, b.channels.length) })));
    if (!this.renderer) return;
    this._updateWanted(); this._kick();
  }
  setGrid(on) { this.gridOn = !!on; this.gridKey = ''; if (this.renderer) { this._syncGrid(); this._kick(); } }
  destroy() {
    cancelAnimationFrame(this.raf); this.ro?.disconnect(); this.abort?.abort();
    for (const e of this.tiles?.values() || []) this._dropTile(e);
    for (const l of this.layers?.values() || []) freeTexture(l.tex);
    this.renderer?.dispose(); this.canvas?.remove(); this.aladin = null;
  }

  // ---------------- setup ----------------
  async _init(ra, dec, fovDeg) {
    this.v = { ra: wrap360(+ra || 0), dec: clampDec(+dec || 0), fov: clampFov(+fovDeg || 60) };
    if (getComputedStyle(this.el).position === 'static') this.el.style.position = 'relative';
    const canvas = this.canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;outline:none';
    canvas.setAttribute('role', 'img');
    this.el.prepend(canvas);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    } catch (err) {
      canvas.remove();
      this._message("Your browser couldn't start WebGL, so the 3D sky can't be shown here. Search and the time-lapse still work.");
      this.ready = null;
      throw new Error('WebGL unavailable: ' + (err?.message || err));
    }
    this.renderer = renderer;
    renderer.autoClear = false;
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this._message('The 3D sky paused because the graphics driver reset. It comes back by itself.'); });
    canvas.addEventListener('webglcontextrestored', () => { this.msgEl?.remove(); this.msgEl = null; this._kick(); });

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.tileScene = new THREE.Scene();
    this.compMat = mat(COMP_VS, COMP_FS, { tex: { value: this.rt.texture }, alpha: { value: 1 }, tint: { value: new THREE.Vector3(1, 1, 1) }, sat: { value: 1 } });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compMat); quad.frustumCulled = false;
    this.compScene = new THREE.Scene(); this.compScene.add(quad);
    this.fgScene = new THREE.Scene();
    this.tiles = new Map(); this.geos = new Map(); this.layers = new Map();
    this.queue = []; this.inflight = 0; this.abort = new AbortController(); this.uploadsLeft = UPLOADS_PER_FRAME;

    try { this._buildStars(await (await fetch(STARS_URL)).json()); }
    catch (err) { console.warn('sky3d: stars unavailable', err); }

    this._resize();
    this.ro = new ResizeObserver(() => this._resize()); this.ro.observe(this.el);
    this._bindInput();
    this.aladin = { getFov: () => [this.v.fov, vfov(this.v.fov, this.w || 1, this.h || 1)] }; // SkyMap compatibility shim
    this._updateWanted();
    this._changed();
  }

  _message(text) {
    this.msgEl?.remove();
    const m = this.msgEl = document.createElement('div');
    m.setAttribute('role', 'status');
    m.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;color:#EDE5DA;background:#0E0B09;font:14px/1.5 system-ui,sans-serif;z-index:1';
    m.textContent = text;
    this.el.append(m);
  }

  _buildStars(data) {
    const rows = data.stars, n = rows.length;
    const x = new Float32Array(n * 3), mag = new Float32Array(n), col = new Float32Array(n * 3);
    rows.forEach((r, i) => { x.set(radecToVec(r[1], r[2]), i * 3); mag[i] = r[3]; col.set(starColor(r[4]), i * 3); });
    this.stars = { x, mag, rows, names: data.names || {} };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(x, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    this.starMat = mat(STAR_VS, STAR_FS, { uScale: { value: 1 }, uAlpha: { value: 1 }, uMagLim: { value: 6.9 } }, { blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, this.starMat); pts.frustumCulled = false; pts.renderOrder = 10;
    this.fgScene.add(pts);
  }

  _resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!(w > 0 && h > 0)) return;
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt.setSize(s.x, s.y);
    this._changed();
  }

  _view() { return { ra: this.v.ra, dec: this.v.dec, fov: this.v.fov, w: this.w || 1, h: this.h || 1 }; }
  _reduced() { return document.documentElement.dataset.motion === 'reduce'; }
  _changed() { this.viewDirty = true; this._kick(); }
  _kick() { if (!this.raf && this.renderer) this.raf = requestAnimationFrame((t) => this._frame(t)); }

  // ---------------- input ----------------
  _bindInput() {
    const c = this.canvas, pts = new Map();
    let drag = null, pinch = null, hoverXY = null, hoverQueued = false;
    const local = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const grab = (a, b) => { // move the sky so the point under a goes under b
      const view = this._view(), fr = frame(view.ra, view.dec);
      const [ra0, de0] = vecToRadec(unproject(view, a[0], a[1], fr)), [ra1, de1] = vecToRadec(unproject(view, b[0], b[1], fr));
      const dra = Math.max(-45, Math.min(45, wrap180(ra0 - ra1))), dde = de0 - de1;
      this.v.ra = wrap360(this.v.ra + dra); this.v.dec = clampDec(this.v.dec + dde);
      return [dra, dde];
    };
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      c.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, local(e));
      this.anim = null; this.inertia = null; this.zoomAnim = null;
      if (pts.size === 1) drag = { start: local(e), last: local(e), t0: performance.now(), moved: false, samples: [] };
      else if (pts.size === 2) {
        const [p, q] = [...pts.values()];
        pinch = { d0: Math.hypot(p[0] - q[0], p[1] - q[1]) || 1, fov0: this.v.fov, mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] };
        if (drag) drag.moved = true;
      }
      c.style.cursor = 'grabbing';
    });
    c.addEventListener('pointermove', (e) => {
      const xy = local(e);
      if (!pts.has(e.pointerId)) { // hover
        hoverXY = xy;
        if (!hoverQueued) { hoverQueued = true; requestAnimationFrame(() => { hoverQueued = false; if (hoverXY) this._hover(hoverXY); }); }
        return;
      }
      pts.set(e.pointerId, xy);
      if (pinch && pts.size >= 2) {
        const [p, q] = [...pts.values()], mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
        grab(pinch.mid, mid); pinch.mid = mid;
        this._zoomAt(mid, this._gestureFov(pinch.fov0 * pinch.d0 / d));
        this._changed();
        return;
      }
      if (!drag) return;
      if (!drag.moved && Math.hypot(xy[0] - drag.start[0], xy[1] - drag.start[1]) > 4) drag.moved = true;
      if (!drag.moved) return;
      const [dra, dde] = grab(drag.last, xy);
      drag.last = xy;
      const now = performance.now();
      drag.samples.push([now, dra, dde]);
      while (drag.samples.length && now - drag.samples[0][0] > 80) drag.samples.shift();
      if (this.hovered != null) { this.hovered = null; this.onHover?.(null); }
      this._changed();
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pinch) { if (pts.size < 2) pinch = null; if (pts.size === 1) { const p = [...pts.values()][0]; drag = { start: p, last: p, t0: performance.now(), moved: true, samples: [] }; } else drag = null; c.style.cursor = 'grab'; return; }
      if (pts.size) return;
      c.style.cursor = 'grab';
      const d = drag; drag = null;
      if (!d || e.type === 'pointercancel') return;
      if (!d.moved) {
        if (performance.now() - d.t0 < 700) { const w = this.toWorld(...local(e)); if (w) this.onClick?.(w[0], w[1]); }
        return;
      }
      const s = d.samples, now = performance.now();
      if (!this._reduced() && s.length >= 2 && now - s[s.length - 1][0] < 60) {
        const span = Math.max(8, now - s[0][0]);
        const vra = s.reduce((a, x) => a + x[1], 0) / span * 16.67, vde = s.reduce((a, x) => a + x[2], 0) / span * 16.67;
        if (Math.hypot(vra * Math.cos(this.v.dec * D2R), vde) > 0.01) { this.inertia = { vra, vde, t: now }; this._kick(); }
      }
    };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { hoverXY = null; if (this.hovered != null) { this.hovered = null; this.onHover?.(null); } });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const base = this.zoomAnim ? this.zoomAnim.target : this.v.fov;
      const target = this._gestureFov(base * Math.exp(Math.max(-300, Math.min(300, e.deltaY * k)) * 0.0015));
      this.anim = null; this.inertia = null;
      if (this._reduced()) { this._zoomAt(local(e), target); this._changed(); return; }
      this.zoomAnim = { target, at: local(e), t: performance.now() };
      this._kick();
    }, { passive: false });
  }
  _gestureFov(f) { return Math.max(Math.min(GESTURE_MIN_FOV, this.v.fov), Math.min(MAX_FOV, f)); }
  _zoomAt(xy, fov) { // change the FOV keeping the sky point under xy fixed
    for (let i = 0; i < 2; i++) {
      const a = vecToRadec(unproject(this._view(), xy[0], xy[1]));
      if (i === 0) this.v.fov = clampFov(fov);
      const b = vecToRadec(unproject(this._view(), xy[0], xy[1]));
      this.v.ra = wrap360(this.v.ra + wrap180(a[0] - b[0])); this.v.dec = clampDec(this.v.dec + (a[1] - b[1]));
    }
  }
  _hover(xy) {
    if (!this.stars) return;
    const view = this._view(), dir = unproject(view, xy[0], xy[1]);
    const i = pickStar(this.stars, dir, (9 * view.fov / view.w) * D2R, magLimit(view.fov) + 0.2);
    const hip = i >= 0 ? this.stars.rows[i][0] : null;
    if (hip === this.hovered) return;
    this.hovered = hip;
    if (i < 0) { this.onHover?.(null); return; }
    const r = this.stars.rows[i];
    this.onHover?.({ name: this.stars.names[r[0]] || `HIP ${r[0]}`, type: `Star · V ${r[3].toFixed(1)}`, ra: r[1], dec: r[2], hip: r[0], source: 'Hipparcos' });
  }

  // ---------------- per-frame ----------------
  _frame(now) {
    this.raf = 0;
    const dt = Math.min(100, now - (this.lastT || now)); this.lastT = now;
    let again = false;
    if (this.anim) {
      const a = this.anim, t = Math.min(1, (now - a.t0) / a.dur), e = easeInOut(t);
      Object.assign(this.v, slerpRadec(a.from, a.to, e));
      this.v.dec = clampDec(this.v.dec);
      this.v.fov = Math.exp(Math.log(a.from.fov) + (Math.log(a.to.fov) - Math.log(a.from.fov)) * e);
      if (t >= 1) { Object.assign(this.v, a.to); this.anim = null; } else again = true;
      this.viewDirty = true;
    }
    if (this.inertia) { // damping 0.12 per frame; stop below 0.01°/frame
      const f = dt / 16.67, k = Math.pow(0.88, f), m = this.inertia;
      this.v.ra = wrap360(this.v.ra + m.vra * f); this.v.dec = clampDec(this.v.dec + m.vde * f);
      m.vra *= k; m.vde *= k;
      if (Math.hypot(m.vra * Math.cos(this.v.dec * D2R), m.vde) < 0.01) this.inertia = null; else again = true;
      this.viewDirty = true;
    }
    if (this.zoomAnim) {
      const z = this.zoomAnim, k = 1 - Math.pow(0.72, dt / 16.67);
      const f = Math.exp(Math.log(this.v.fov) + (Math.log(z.target) - Math.log(this.v.fov)) * k);
      this._zoomAt(z.at, Math.abs(Math.log(z.target / f)) < 0.002 ? z.target : f);
      if (this.v.fov === z.target) this.zoomAnim = null; else again = true;
      this.viewDirty = true;
    }
    if (this.viewDirty) {
      this.viewDirty = false;
      this._updateWanted();
      if (this.gridOn) this._syncGrid();
      try { this.onView?.(); } catch (err) { console.warn('sky3d onView', err); }
      clearTimeout(this.moveT);
      this.moveT = setTimeout(() => this._settled(), MOVE_SETTLE_MS);
    }
    const t0 = performance.now();
    if (this._render(now)) again = true;
    this.stats.renders++; this.stats.lastMs = performance.now() - t0;
    if (again) this._kick();
  }

  _settled() {
    const { ra, dec, fov } = this.v;
    const h = ra / 15, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    const f = fov >= 1 ? `${fov.toFixed(fov >= 10 ? 0 : 1)}°` : fov * 60 >= 1 ? `${(fov * 60).toFixed(1)}′` : `${(fov * 3600).toFixed(0)}″`;
    this.canvas?.setAttribute('aria-label', `Sky. Centre RA ${hh}h ${String(mm).padStart(2, '0')}m, Dec ${dec >= 0 ? '+' : '−'}${Math.abs(dec).toFixed(0)}°. Field of view ${f}.`);
    try { this.onMove?.(this.center(), this.fov()); } catch (err) { console.warn('sky3d onMove', err); }
  }

  // ---------------- imagery layers and tiles ----------------
  _layerUrls() {
    const base = (ch, tint) => `${location.origin}/hips/spherex/${ch}` + (tint ? `/t/${tint}` : '');
    return this.bandSpec.length ? this.bandSpec.map(b => ({ url: base(b.ch, b.color), w: b.w, additive: true })) : [{ url: base(this.channel), w: 1, additive: false }];
  }
  _layer(url) {
    let l = this.layers.get(url);
    if (!l) {
      l = { url, tex: null, mesh: null, state: 'loading', used: 0 };
      this.layers.set(url, l);
      loadTexture(`${url}/Norder3/Allsky.png`, this.abort.signal).then((tex) => {
        if (!this.allskyGeo) this.allskyGeo = allskyGeometry(tex.image.width, tex.image.height);
        tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
        l.tex = tex; l.state = 'ready';
        l.mesh = new THREE.Mesh(this.allskyGeo, mat(TILE_VS, TILE_FS, { map: { value: tex }, alpha: { value: 1 }, nearest: { value: 0 }, texSize: { value: new THREE.Vector2(tex.image.width, tex.image.height) } }));
        l.mesh.frustumCulled = false; l.mesh.renderOrder = -1;
        this._trimLayers(); this._kick();
      }).catch((err) => { l.state = 'failed'; if (err?.name !== 'AbortError') console.warn('sky3d: allsky failed', url, err); });
    }
    l.used = performance.now();
    return l;
  }
  _trimLayers() { // keep at most 16 all-sky textures (about 13 MB each)
    if (this.layers.size <= 16) return;
    const active = new Set(this._layerUrls().map(x => x.url).concat(this.prevBase ? [this.prevBase] : []));
    const old = [...this.layers.values()].filter(l => !active.has(l.url) && l.state !== 'loading').sort((a, b) => a.used - b.used);
    for (const l of old.slice(0, this.layers.size - 16)) { freeTexture(l.tex); l.mesh?.material.dispose(); this.layers.delete(l.url); }
  }

  _updateWanted() {
    if (!this.w) return;
    const view = this._view(), order = chooseOrder(view, Math.min(2, devicePixelRatio || 1));
    const tiles = order ? visibleTiles(view, order).slice(0, MAX_VIS) : [];
    this.want = { order, tiles };
    const layers = this._layerUrls();
    for (const l of layers) this._layer(l.url);
    const q = [];
    for (const n of tiles) for (const l of layers) {
      const url = `${l.url}/${tilePath(order, n)}`;
      if (!this.tiles.has(url)) q.push({ url, order, n });
    }
    this.queue = q;
    this._pump();
  }
  _pump() {
    while (this.inflight < MAX_INFLIGHT && this.queue.length) {
      const job = this.queue.shift();
      if (this.tiles.has(job.url)) continue;
      const e = { ...job, state: 'loading', tex: null, mesh: null, born: 0, used: 0 };
      this.tiles.set(job.url, e);
      this.inflight++;
      loadTexture(job.url, this.abort.signal)
        .then((tex) => { e.tex = tex; e.state = 'decoded'; })
        .catch((err) => { e.state = 'failed'; if (err?.name !== 'AbortError') console.warn('sky3d: tile failed', job.url, err?.message); })
        .finally(() => { this.inflight--; this._evict(); this._pump(); this._kick(); });
    }
  }
  _evict() {
    const ready = [...this.tiles.values()].filter(e => e.tex);
    if (ready.length <= MAX_TEX) return;
    const cutoff = this.lastRender || 0;
    ready.filter(e => e.used < cutoff).sort((a, b) => a.used - b.used).slice(0, ready.length - MAX_TEX).forEach(e => this._dropTile(e));
  }
  _dropTile(e) { freeTexture(e.tex); e.mesh?.material.dispose(); this.tiles.delete(e.url); }

  // A tile entry ready to draw (uploading at most a few new textures per frame to avoid hitches).
  _drawable(url, now) {
    const e = this.tiles.get(url);
    if (!e || !e.tex) return null;
    if (e.state === 'decoded') {
      if (this.uploadsLeft <= 0) return null;
      this.uploadsLeft--;
      this.renderer.initTexture(e.tex);
      let g = this.geos.get(`${e.order}/${e.n}`);
      if (!g) { g = tileGeometry(e.order, e.n); this.geos.set(`${e.order}/${e.n}`, g); }
      e.mesh = new THREE.Mesh(g, mat(TILE_VS, TILE_FS, { map: { value: e.tex }, alpha: { value: 0 }, nearest: { value: 0 }, texSize: { value: new THREE.Vector2(e.tex.image.width, e.tex.image.height) } }));
      e.mesh.frustumCulled = false; e.mesh.renderOrder = e.order;
      e.state = 'ready'; e.born = now;
    }
    e.used = now;
    return e;
  }

  _render(now) {
    if (!this.w) return false;
    const r = this.renderer, cam = this.camera, v = this.v;
    this.uploadsLeft = UPLOADS_PER_FRAME; this.lastRender = now;
    const fr = frame(v.ra, v.dec);
    const X = new THREE.Vector3(...fr.right), Y = new THREE.Vector3(...fr.up), Z = new THREE.Vector3(-fr.f[0], -fr.f[1], -fr.f[2]);
    cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    cam.fov = vfov(v.fov, this.w, this.h); cam.aspect = this.w / this.h; cam.updateProjectionMatrix(); cam.updateMatrixWorld();

    r.setRenderTarget(null); r.setClearColor(BG, 1); r.clear();
    let busy = false;
    const ramp = detailRamp(v.fov), a = imageryAlpha(v.fov), nearest = v.fov < 1 ? 1 : 0;
    let layers = this._layerUrls();
    if (!layers[0].additive) { // base channel: keep showing the previous channel until the new one has loaded
      const l = this.layers.get(layers[0].url);
      if (l?.state === 'ready') this.prevBase = l.url;
      else if (this.prevBase && this.layers.get(this.prevBase)?.state === 'ready') layers = [{ ...layers[0], url: this.prevBase }];
    }
    for (const L of layers) {
      const l = this.layers.get(L.url);
      if (!l || l.state !== 'ready') continue; // a finished load asks for a new frame itself
      l.used = now;
      const sc = this.tileScene; sc.clear(); sc.add(l.mesh);
      if (this.want?.order) {
        const o = this.want.order, extra = new Set();
        for (const n of this.want.tiles) {
          const url = `${L.url}/${tilePath(o, n)}`, e = this._drawable(url, now);
          if (e) { sc.add(e.mesh); if (now - e.born < TILE_FADE_MS) busy = true; e.mesh.material.uniforms.alpha.value = Math.min(1, (now - e.born) / TILE_FADE_MS); e.mesh.material.uniforms.nearest.value = nearest; continue; }
          const st = this.tiles.get(url)?.state;
          if (st === 'decoded') busy = true; // waiting for its upload slot
          let found = false; // fall back to a loaded ancestor, else loaded children
          for (let po = o - 1; po >= 3 && !found; po--) {
            const pu = `${L.url}/${tilePath(po, parent(n, o - po))}`, pe = this._drawable(pu, now);
            if (pe) { extra.add(pe); found = true; }
          }
          if (!found && o < 5) for (const k of children(n)) { const ce = this._drawable(`${L.url}/${tilePath(o + 1, k)}`, now); if (ce) extra.add(ce); }
        }
        for (const e of extra) { e.mesh.material.uniforms.alpha.value = Math.min(1, (now - e.born) / TILE_FADE_MS); e.mesh.material.uniforms.nearest.value = nearest; sc.add(e.mesh); }
      }
      r.setRenderTarget(this.rt); r.setClearColor(0x000000, 1); r.clear(); r.render(sc, cam);
      r.setRenderTarget(null);
      const u = this.compMat.uniforms;
      if (L.additive) { this.compMat.blending = THREE.AdditiveBlending; u.alpha.value = L.w * a; u.tint.value.set(1, 1, 1); u.sat.value = 1; }
      else {
        this.compMat.blending = THREE.NormalBlending; u.alpha.value = a;
        u.tint.value.set(...MW_TINT.map((t, i) => t + (DETAIL_TINT[i] - t) * ramp)); u.sat.value = 0.6 + 0.4 * ramp;
      }
      r.render(this.compScene, cam);
    }
    if (this.starMat) {
      this.starMat.uniforms.uScale.value = r.getPixelRatio(); // CSS px -> device px (capped at 2)
      this.starMat.uniforms.uAlpha.value = starAlpha(v.fov);
      this.starMat.uniforms.uMagLim.value = magLimit(v.fov);
    }
    r.render(this.fgScene, cam);
    this.stats.frames++;
    return busy;
  }

  // ---------------- RA/Dec grid (off by default) ----------------
  _syncGrid() {
    if (!this.gridOn) { if (this.gridMesh) { this.fgScene.remove(this.gridMesh); this.gridMesh.geometry.dispose(); this.gridMesh = null; } return; }
    const v = this.v, step = gridStep(v.fov), R = viewRadius(this._view()) * R2D * 1.4 + step;
    const c = this.gridC;
    if (this.gridKey === String(step) && c && Math.acos(Math.min(1, radecToVec(c.ra, c.dec).reduce((s, x, i) => s + x * radecToVec(v.ra, v.dec)[i], 0))) * R2D < R / 4) return;
    this.gridKey = String(step); this.gridC = { ra: v.ra, dec: v.dec };
    const decLo = Math.max(-90, v.dec - R), decHi = Math.min(90, v.dec + R);
    const wide = Math.abs(v.dec) + R >= 89 || R / Math.cos(v.dec * D2R) >= 180;
    const span = wide ? 180 : R / Math.cos(v.dec * D2R);
    const raLo = wide ? 0 : v.ra - span, raHi = wide ? 360 : v.ra + span;
    let raStep = step; while ((raHi - raLo) / raStep > 240) raStep *= 2;
    const res = Math.max(R / 60, 1e-5), pos = [], eq = [];
    const seg = (p, q, e) => { pos.push(...p, ...q); eq.push(e, e); };
    for (let ra = Math.ceil(raLo / raStep) * raStep; ra <= raHi + 1e-9; ra += raStep) {
      if (wide && ra >= 360 - 1e-9) break;
      let prev = radecToVec(ra, decLo);
      for (let d = decLo + res; d <= decHi + res / 2; d += res) { const p = radecToVec(ra, Math.min(d, decHi)); seg(prev, p, 0); prev = p; }
    }
    for (let d = Math.ceil(decLo / step) * step; d <= decHi + 1e-9; d += step) {
      if (Math.abs(d) >= 90) continue;
      const rr = Math.min(raHi - raLo, Math.max(res / Math.max(0.02, Math.cos(d * D2R)), (raHi - raLo) / 720));
      let prev = radecToVec(raLo, d);
      for (let ra = raLo + rr; ra <= raHi + rr / 2; ra += rr) { const p = radecToVec(Math.min(ra, raHi), d); seg(prev, p, Math.abs(d) < 1e-9 ? 1 : 0); prev = p; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aEq', new THREE.Float32BufferAttribute(eq, 1));
    if (!this.gridMesh) {
      this.gridMesh = new THREE.LineSegments(g, mat(GRID_VS, GRID_FS, {}));
      this.gridMesh.frustumCulled = false; this.gridMesh.renderOrder = 5; this.fgScene.add(this.gridMesh);
    } else { this.gridMesh.geometry.dispose(); this.gridMesh.geometry = g; }
  }
}

export default Sky3D;
