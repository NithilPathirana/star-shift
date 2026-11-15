/* Shared renderer (from the Design Studio session; AI-written, Claude by Anthropic): draws SPHEREx cutouts onto a canvas.
   Used by web/app/ui.js. AI-written code for team Proper Motion, NASA Space Apps 2026. */
(function () {
  const R = {};

  // Same stretch as evidence/render_evidence.py (2 to 99.7 percentile, asinh), but masked pixels stay null.
  // mode: 'auto' (asinh, as evidence), 'linear' (no asinh), 'strong' (asinh 30, tighter clip: lifts faint detail)
  R.stretch = function (d, mode) {
    mode = mode || 'auto';
    const v = d.filter(x => x != null).sort((a, b) => a - b);
    const q = p => v[Math.min(v.length - 1, Math.max(0, Math.round(p / 100 * (v.length - 1))))];
    const lo = q(mode === 'strong' ? 5 : 2), hi = q(mode === 'strong' ? 99 : 99.7);
    const a = mode === 'strong' ? 30 : 10, k = Math.asinh(a);
    return d.map(x => {
      if (x == null) return null;
      const t = Math.min(1, Math.max(0, (x - lo) / Math.max(hi - lo, 1e-12)));
      return mode === 'linear' ? t : Math.asinh(a * t) / k;
    });
  };

  // Colour ramps: arrays of [t, [r,g,b]]
  R.ramps = {
    grey: [[0, [4, 6, 10]], [1, [246, 248, 252]]],
    neutral: [[0, [10, 9, 8]], [1, [250, 248, 245]]],
    cool: [[0, [3, 8, 18]], [0.45, [92, 120, 160]], [1, [244, 247, 252]]],
    heat: [[0, [2, 4, 10]], [0.3, [16, 52, 104]], [0.62, [196, 156, 52]], [0.85, [240, 214, 140]], [1, [255, 252, 240]]],
    copper: [[0, [12, 9, 7]], [0.28, [62, 28, 14]], [0.58, [176, 100, 48]], [0.82, [232, 182, 120]], [1, [255, 246, 232]]],
    // default (blue/white/neon-yellow) look: #050B1A > #0E2A6B > #2F6BE0 > #A9DBFF > #FFFFFF, every channel rises, so luminance rises strictly
    ice: [[0, [5, 11, 26]], [0.28, [14, 42, 107]], [0.58, [47, 107, 224]], [0.82, [169, 219, 255]], [1, [255, 255, 255]]]
  };
  // Image colours (access.js, Nithil 15 Nov): magma-like black > deep red > pink > near-white; viridis-like purple > teal > yellow.
  R.ramps.magma = [[0, [4, 3, 10]], [0.2, [52, 8, 30]], [0.42, [128, 20, 56]], [0.62, [206, 62, 116]], [0.8, [246, 140, 172]], [1, [255, 244, 240]]];
  R.ramps.viridis = [[0, [62, 4, 84]], [0.15, [70, 42, 122]], [0.3, [58, 82, 139]], [0.45, [44, 114, 142]], [0.6, [32, 146, 140]], [0.75, [60, 188, 117]], [0.88, [150, 216, 64]], [1, [253, 231, 37]]];
  // Custom: black > the picked hue > white, built in OKLab with lightness rising evenly; chroma is cut until the colour fits sRGB.
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const gam = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  R.oklabL = rgb => { const [r, g, b] = rgb.map(lin); return 0.2104542553 * Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) + 0.793617785 * Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) - 0.0040720468 * Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b); };
  function labRGB(L, A, B) {
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  }
  R.customRamp = function (hex) {
    const n = parseInt(String(hex || '#E040A0').replace('#', ''), 16) || 0, rgb = [n >> 16, (n >> 8) & 255, n & 255].map(lin);
    const l = Math.cbrt(0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2]), m = Math.cbrt(0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2]), s = Math.cbrt(0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2]);
    const Lc = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    const C = Math.hypot(A, B), h = Math.atan2(B, A), L0 = 0.1, L1 = 0.99, tc = Math.min(0.8, Math.max(0.25, (Lc - L0) / (L1 - L0))), N = 24, out = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, L = L0 + (L1 - L0) * t;
      let c = Math.max(0.02, C) * (t <= tc ? t / tc : (1 - t) / (1 - tc)), v = labRGB(L, c * Math.cos(h), c * Math.sin(h));
      for (let k = 0; k < 40 && v.some(x => x < 0 || x > 1); k++) { c *= 0.9; v = labRGB(L, c * Math.cos(h), c * Math.sin(h)); }
      out.push([t, v.map(x => Math.round(gam(Math.min(1, Math.max(0, x)))))]);
    }
    return out;
  };
  const IMGS = ['ice', 'copper', 'grey', 'magma', 'viridis', 'custom'];
  // The look on <html> (access.js): 'classic' keeps copper; the default look swaps the copper ramp for ice.
  R.classic = () => typeof document !== 'undefined' && document.documentElement.dataset.axLook === 'classic';
  // 'copper' is the viewer's "image colours" setting: the ramp access.js chose (the user's pick, else the colour mode's, else the look's)
  R.imageRamp = function () {
    const ds = typeof document !== 'undefined' ? document.documentElement.dataset : {}, id = IMGS.includes(ds.axImg) ? ds.axImg : (R.classic() ? 'copper' : 'ice');
    if (id !== 'custom') return id;
    const hue = ds.axImgHue || '#E040A0';
    if (R._customHue !== hue) { R.ramps.custom = R.customRamp(hue); R._customHue = hue; }
    return 'custom';
  };
  R.lookRamp = name => (name === 'copper' ? R.imageRamp() : name) || 'grey';
  // guide cross: the marks colour when a mode or the user set one; else white, which reads on both ice and the yellow ring
  R.crossColor = () => { const mk = typeof document !== 'undefined' && document.documentElement.dataset.axMark; return mk || (R.classic() ? '#9DB89F' : 'rgba(255,255,255,.7)'); };
  function ramp(stops, t) {
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, a] = stops[i - 1], [t1, b] = stops[i], f = (t - t0) / (t1 - t0);
        return [0, 1, 2].map(j => Math.round(a[j] + (b[j] - a[j]) * f));
      }
    }
    return stops[stops.length - 1][1];
  }
  R.rampRGB = (name, t) => ramp(R.ramps[R.lookRamp(name)], t);
  R.rampCss = function (name) {
    return 'linear-gradient(90deg,' + R.ramps[R.lookRamp(name)].map(([t, c]) => `rgb(${c}) ${t * 100}%`).join(',') + ')';
  };

  /* opts: ramp, cell (canvas px per data pixel), ring (bool), ringColor, stretch ('auto'|'linear'|'strong'), noData (fill).
     No-data pixels (masked, saturated cores, cutout past the detector edge) get one calm flat fill a shade
     darker than the stage, never hatching: they are not detector flags (the FLAGS overlay is contam-ui.js).
     maskBg / maskInk / hatch from older callers are ignored here. */
  // no data: a shade darker than the stage (#15110E copper look, #0A1121 default look)
  Object.defineProperty(R, 'NO_DATA', { get: () => (R.classic() ? '#100D0B' : '#060C18'), enumerable: true });
  R.draw = function (canvas, frame, n, opts) {
    const o = Object.assign({ ramp: 'grey', cell: 20, ring: false, ringColor: '#D4AF37', noData: R.NO_DATA }, opts || {});
    const c = o.cell, ctx = canvas.getContext('2d');
    if (canvas.width !== n * c || canvas.height !== n * c) { canvas.width = n * c; canvas.height = n * c; } // width OR height (Compare's second canvas)
    const sm = o.stretch || 'auto', key = '_s_' + sm;
    const s = frame[key] || (frame[key] = R.stretch(frame.d, sm));
    const stops = R.ramps[R.lookRamp(o.ramp)];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const t = s[y * n + x];
      if (t == null) {
        ctx.fillStyle = o.noData; ctx.fillRect(x * c, y * c, c, c);
      } else {
        const [r, g, b] = ramp(stops, t);
        ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(x * c, y * c, c, c);
      }
    }
    if (o.ring && !frame.ringOff) {
      const [ex, ey] = frame.exp;
      ctx.strokeStyle = o.ringColor; ctx.lineWidth = Math.max(2, c / 8);
      ctx.setLineDash([c * 0.5, c * 0.35]);
      ctx.beginPath(); ctx.arc((ex + 0.5) * c, (ey + 0.5) * c, 2.2 * c, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  // Group frames into visits (gap > 30 days starts a new visit)
  R.visits = function (frames) {
    const out = []; let cur = null;
    frames.forEach((f, i) => {
      if (!cur || f.mjd - frames[i - 1].mjd > 30) { cur = { from: i, to: i }; out.push(cur); } else cur.to = i;
    });
    return out;
  };

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  R.fmtDate = function (iso, withTime) {
    const d = new Date(iso.length > 19 ? iso.slice(0, 19) + 'Z' : iso + 'Z');
    const s = `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    return withTime ? s + ` · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC` : s;
  };
  R.fmtMonth = iso => { const d = new Date(iso.slice(0, 10) + 'T00:00:00Z'); return `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

  // Sexagesimal formatting for the info panel
  R.fmtRA = deg => { let ts = Math.round(((deg % 360) + 360) % 360 / 15 * 36000) / 10; const hh = Math.floor(ts / 3600) % 24; ts -= Math.floor(ts / 3600) * 3600; const mm = Math.floor(ts / 60); const ss = (ts - mm * 60).toFixed(1); return `${String(hh).padStart(2, '0')}h ${String(mm).padStart(2, '0')}m ${ss.padStart(4, '0')}s`; };
  R.fmtDec = deg => { const sg = deg < 0 ? '−' : '+'; let ts = Math.round(Math.abs(deg) * 3600); const d = Math.floor(ts / 3600); ts -= d * 3600; const m = Math.floor(ts / 60), s = ts - m * 60; return `${sg}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`; };

  // Minimal frame player
  R.Player = function (count, onFrame) {
    const p = { i: 0, fps: 4, playing: false, timer: null };
    p.set = i => { p.i = (i + count) % count; onFrame(p.i); };
    p.play = () => { if (p.playing) return; p.playing = true; tick(); onFrame(p.i); };
    p.pause = () => { p.playing = false; clearTimeout(p.timer); onFrame(p.i); };
    p.toggle = () => p.playing ? p.pause() : p.play();
    function tick() { if (!p.playing) return; p.timer = setTimeout(() => { p.set(p.i + 1); tick(); }, 1000 / p.fps); }
    return p;
  };

  R.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.MockRender = R;
})();
