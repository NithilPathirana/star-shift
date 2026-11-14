// Pannable, zoomable SPHEREx sky map (Aladin Lite, self-hosted) with a SIMBAD name layer.
// Aladin loads only when the map is first shown. Tiles come from our relay
// (/hips/spherex/<channel>), never from CDS servers.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { parseCSV } from '../core/irsa.js';
import { SIMBAD_TAP } from '../core/resolve.js';
import { prebakedFetch } from '../core/prebaked.js'; // the five demo targets answer from web/prebaked/ (Claude)

export const CHANNEL_UM = [0.753, 0.771, 0.790, 0.809, 0.828, 0.848, 0.868, 0.889, 0.910, 0.932, 0.955, 0.978, 1.001, 1.025, 1.050, 1.075, 1.102, 1.113, 1.139, 1.167, 1.195, 1.224, 1.254, 1.284, 1.315, 1.346, 1.378, 1.412, 1.446, 1.481, 1.517, 1.554, 1.592, 1.631, 1.656, 1.695, 1.735, 1.775, 1.818, 1.861, 1.905, 1.949, 1.995, 2.041, 2.089, 2.139, 2.189, 2.240, 2.292, 2.345, 2.399, 2.445, 2.506, 2.575, 2.646, 2.719, 2.794, 2.871, 2.951, 3.033, 3.118, 3.204, 3.293, 3.383, 3.476, 3.570, 3.667, 3.768, 3.833, 3.867, 3.901, 3.935, 3.970, 4.005, 4.040, 4.076, 4.112, 4.148, 4.184, 4.220, 4.257, 4.294, 4.331, 4.368, 4.405, 4.435, 4.467, 4.500, 4.533, 4.566, 4.600, 4.635, 4.669, 4.704, 4.739, 4.773, 4.808, 4.843, 4.879, 4.915, 4.951, 4.988];

export function nearestChannel(um) {
  let best = 0;
  for (let i = 1; i < CHANNEL_UM.length; i++) if (Math.abs(CHANNEL_UM[i] - um) < Math.abs(CHANNEL_UM[best] - um)) best = i;
  return best;
}

// Common SIMBAD object types in plain words (fallback: SIMBAD's own code).
const OTYPE = {
  '*': 'Star', 'PM*': 'High proper-motion star', 'BD*': 'Brown dwarf', 'LM*': 'Low-mass star', 'V*': 'Variable star', 'Mi*': 'Mira variable',
  'TT*': 'T Tauri star', 'Y*O': 'Young stellar object', 'RG*': 'Red giant', 'C*': 'Carbon star', 'WD*': 'White dwarf', '**': 'Double star',
  'SB*': 'Spectroscopic binary', 'EB*': 'Eclipsing binary', 'G': 'Galaxy', 'GiG': 'Galaxy in group', 'AGN': 'Active galaxy', 'QSO': 'Quasar',
  'ClG': 'Galaxy cluster', 'OpC': 'Open cluster', 'GlC': 'Globular cluster', 'PN': 'Planetary nebula', 'HII': 'HII region', 'RNe': 'Reflection nebula',
  'MoC': 'Molecular cloud', 'DNe': 'Dark nebula', 'IR': 'Infrared source', 'Em*': 'Emission-line star', 'BY*': 'BY Draconis variable', 'Ro*': 'Rotating variable',
  's*r': 'Red supergiant', 's*b': 'Blue supergiant', 's*y': 'Yellow supergiant', 'gD*': 'Delta Scuti variable', 'Pu*': 'Pulsating variable', 'SN*': 'Supernova', 'HB*': 'Horizontal-branch star', 'AB*': 'Asymptotic giant branch star', 'Ce*': 'Cepheid', 'RR*': 'RR Lyrae variable', 'X': 'X-ray source', 'Rad': 'Radio source',
};
export function otypeName(code) { return OTYPE[code] || code || 'Object'; }

// Named objects in a circle, most-studied first (SIMBAD Harvard mirror; CORS allowed).
// Sorting is done here: "ORDER BY nbref" inside a cone search takes ~18 s on the mirror
// (0.9 s without it, checked 14 Nov 2026). Gives up after `timeoutMs`.
export async function simbadCone(ra, dec, radiusDeg, { limit = 200, fetchFn = prebakedFetch, signal, timeoutMs = 12000 } = {}) {
  const adql = `SELECT TOP 2000 main_id, ra, dec, otype, nbref FROM basic
    WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${+ra}, ${+dec}, ${+radiusDeg}))`.replace(/\s+/g, ' ');
  const url = `${SIMBAD_TAP}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(adql)}`;
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetchFn(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!res.ok) throw new Error('SIMBAD HTTP ' + res.status);
  return parseCSV(await res.text())
    .filter(r => r.ra !== '' && r.dec !== '')
    .map(r => ({ name: r.main_id.replace(/^NAME /, ''), ra: +r.ra, dec: +r.dec, otype: r.otype, refs: +r.nbref || 0 }))
    .sort((a, b) => b.refs - a.refs)
    .slice(0, limit);
}

// Base map drawn in warm grey through the relay's palette tint (raised black point, gentle
// gamma), so faint noise doesn't read as harsh black/white diamonds (DESIGN review, 14 Nov).
const BASE_TINT = 'd9cdbd';

const HIDE = { showReticle: true, showZoomControl: false, showFullscreenControl: false, showLayersControl: false, showGotoControl: false,
  showShareControl: false, showFrame: false, showCooGrid: false, showCooGridControl: false, showProjectionControl: false,
  showSimbadPointerControl: false, showSettingsControl: false, showCooLocation: false, showFov: false, showContextMenu: false, showStatusBar: false };

export class SkyMap {
  constructor(el, { onClick, onHover, onMove, onView } = {}) {
    this.el = el; this.onClick = onClick; this.onHover = onHover; this.onMove = onMove; this.onView = onView;
    this.channel = 33; // 1.63 µm: stars bright, low noise
    this.ready = null; this.names = null; this.namesKey = ''; this.bandLayers = [];
  }

  surveyURL(ch, tint) { return `${location.origin}/hips/spherex/${ch}` + (tint ? `/t/${tint}` : ''); }

  init(ra, dec, fovDeg = 1) {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const { default: A } = await import('../vendor/aladin-lite-3.8.2/aladin.js');
      await A.init;
      this.A = A;
      this.aladin = A.aladin(this.el, { ...HIDE, survey: this.surveyURL(this.channel, BASE_TINT), log: false, hipsList: [], fov: fovDeg,
        target: `${ra} ${dec}`, projection: 'TAN', cooFrame: 'ICRSd', backgroundColor: 'rgb(0,0,0)', reticleColor: '#ff6b5e', reticleSize: 18 });
      this.names = A.catalog({ name: 'Named objects (SIMBAD)', sourceSize: 14, shape: 'circle', color: 'rgba(138,184,255,0.85)' });
      this.aladin.addCatalog(this.names);
      // Aladin's WebAssembly core must not be called again from inside its own callbacks
      // ('recursive use of an object' error), so every handler runs after the event returns.
      const later = (fn) => setTimeout(() => { try { fn(); } catch (err) { console.warn('sky map', err); } }, 0);
      this.aladin.on('click', (e) => { if (e && !e.isDragging && Number.isFinite(e.ra)) { const { ra, dec } = e; later(() => this.onClick?.(ra, dec)); } });
      this.aladin.on('objectHovered', (o) => { if (o?.data) { const d = o.data; later(() => this.onHover?.(d)); } });
      this.aladin.on('objectHoveredStop', () => later(() => this.onHover?.(null)));
      let t = null;
      const moved = () => { clearTimeout(t); t = setTimeout(() => { this.refreshNames(); this.onMove?.(this.center(), this.fov()); }, 350); };
      let viewRaf = 0;
      const view = () => { if (!viewRaf) viewRaf = requestAnimationFrame(() => { viewRaf = 0; try { this.onView?.(); } catch (err) { console.warn('sky map', err); } }); };
      this.aladin.on('positionChanged', () => { view(); moved(); });
      this.aladin.on('zoomChanged', () => { view(); moved(); });
      moved();
      if (this.pendingBands) { const b = this.pendingBands; this.pendingBands = null; this.setBands(b); }
    })();
    return this.ready;
  }

  center() { const [ra, dec] = this.aladin.getRaDec(); return { ra, dec }; }
  toPix(ra, dec) { try { const p = this.aladin.world2pix(ra, dec); return p && Number.isFinite(p[0]) ? p : null; } catch { return null; } }
  toWorld(x, y) { try { const w = this.aladin.pix2world(x, y); return w && Number.isFinite(w[0]) ? w : null; } catch { return null; } }
  setFov(deg) { this.aladin.setFoV(Math.min(180, Math.max(0.01, deg))); }
  panBy(fx, fy) { // fractions of the view; +x = towards east (left on screen), +y = north
    const { ra, dec } = this.center(), f = this.fov();
    this.aladin.gotoRaDec(((ra + fx * f / Math.max(0.2, Math.cos(dec * Math.PI / 180))) % 360 + 360) % 360, Math.max(-89.9, Math.min(89.9, dec + fy * f)));
  }
  fov() { return this.aladin.getFov()[0]; }

  goTo(ra, dec, fovDeg) {
    this.aladin.gotoRaDec(ra, dec);
    if (fovDeg) this.aladin.setFoV(fovDeg);
  }

  setChannel(ch) {
    this.channel = ch;
    if (!this.aladin) return;
    const base = this.aladin.newImageSurvey(this.surveyURL(ch, BASE_TINT), { name: `SPHEREx ${CHANNEL_UM[ch]} µm`, opacity: this.bandLayers.length ? 0 : 1 });
    this.aladin.setBaseImageLayer(base);
    base.setOpacity?.(this.bandLayers.length ? 0 : 1);
  }

  // bands: [{ channels: [..], color: 'rrggbb' }]: tinted channels added together on black.
  setBands(bands) {
    if (!this.aladin) { this.pendingBands = bands; return; }
    for (const name of this.bandLayers) { try { this.aladin.removeImageLayer(name); } catch { /* already gone */ } }
    this.bandLayers = [];
    this.aladin.getBaseImageLayer()?.setOpacity(bands.length ? 0 : 1);
    let k = 0;
    for (const b of bands) {
      for (const ch of b.channels) {
        const name = `band-${k++}`;
        const layer = this.aladin.newImageSurvey(this.surveyURL(ch, b.color), { name });
        this.aladin.setOverlayImageLayer(layer, name);
        layer.setColormap?.('native');
        layer.setOpacity?.(1 / b.channels.length); // average of the channels in the band
        layer.setBlendingConfig?.(true);
        this.bandLayers.push(name);
      }
    }
  }

  async refreshNames() {
    if (!this.aladin) return;
    const fov = this.fov();
    if (fov > 1.5) { this.names.removeAll(); this.namesKey = ''; return; }
    const { ra, dec } = this.center();
    const r = Math.min(1.1, fov * 0.75);
    const key = `${ra.toFixed(2)},${dec.toFixed(2)},${r.toFixed(2)}`;
    if (key === this.namesKey) return;
    this.namesKey = key;
    try {
      const rows = await simbadCone(ra, dec, r, { limit: fov < 0.3 ? 60 : 80 });
      if (this.namesKey !== key) return;
      this.names.removeAll();
      this.names.addSources(rows.map(o => this.A.source(o.ra, o.dec, { name: o.name, type: otypeName(o.otype), otype: o.otype })));
    } catch { /* names are optional; the map keeps working */ }
  }
}
