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
    copper: [[0, [12, 9, 7]], [0.28, [62, 28, 14]], [0.58, [176, 100, 48]], [0.82, [232, 182, 120]], [1, [255, 246, 232]]]
  };
  function ramp(stops, t) {
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, a] = stops[i - 1], [t1, b] = stops[i], f = (t - t0) / (t1 - t0);
        return [0, 1, 2].map(j => Math.round(a[j] + (b[j] - a[j]) * f));
      }
    }
    return stops[stops.length - 1][1];
  }
  R.rampCss = function (name) {
    return 'linear-gradient(90deg,' + R.ramps[name].map(([t, c]) => `rgb(${c}) ${t * 100}%`).join(',') + ')';
  };

  /* opts: ramp, cell (canvas px per data pixel), ring (bool), ringColor, stretch ('auto'|'linear'|'strong'), noData (fill).
     No-data pixels (masked, saturated cores, cutout past the detector edge) get one calm flat fill a shade
     darker than the stage, never hatching: they are not detector flags (the FLAGS overlay is contam-ui.js).
     maskBg / maskInk / hatch from older callers are ignored here. */
  R.NO_DATA = '#100D0B'; // stage is #15110E
  R.draw = function (canvas, frame, n, opts) {
    const o = Object.assign({ ramp: 'grey', cell: 20, ring: false, ringColor: '#D4AF37', noData: R.NO_DATA }, opts || {});
    const c = o.cell, ctx = canvas.getContext('2d');
    if (canvas.width !== n * c) { canvas.width = n * c; canvas.height = n * c; }
    const sm = o.stretch || 'auto', key = '_s_' + sm;
    const s = frame[key] || (frame[key] = R.stretch(frame.d, sm));
    const stops = R.ramps[o.ramp];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const t = s[y * n + x];
      if (t == null) {
        ctx.fillStyle = o.noData; ctx.fillRect(x * c, y * c, c, c);
      } else {
        const [r, g, b] = ramp(stops, t);
        ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(x * c, y * c, c, c);
      }
    }
    if (o.ring) {
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
