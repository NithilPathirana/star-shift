/* Scan loader: the loading screen is the data assembling itself.
   AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026. No images, video or AI art: only the
   real SPHEREx cutouts as they arrive. Plain JS, no dependencies.

   const L = ScanLoader(container, {
     mode: 'scan' | 'sheet',            // 'scan' = band-tinted plate + wavelength ruler; 'sheet' = copper contact sheet
     target: "Barnard's Star", total: 60,
     plan: [{ mjd, um }, ...],          // optional: every expected image, drawn as faint pending ticks (um may be missing: date line only)
     bands: [{ name, min, max, c }],    // the user's colour bands (data colours)
     domain: [0.74, 5.01], reducedMotion: false, startAfter: 8,
     onStart() {}, onRetry() {}
   });
   L.set({ target, total, plan });      // optional: fill these in later, when the archive has answered
   L.add({ d, um, mjd, date, det });    // d = n*n values (null = no data); call once per arrived image, any order
   L.slow('IRSA is slow. 5 of 60 kept. Retrying 3 images');   L.slow(null);
   L.done();  L.destroy();
*/
(function () {
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var COPPER = [[0, [12, 9, 7]], [0.28, [62, 28, 14]], [0.58, [176, 100, 48]], [0.82, [232, 182, 120]], [1, [255, 246, 232]]];
  function hex(h) { var n = parseInt(h.replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function lerp(stops, t) {
    for (var i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
      var a = stops[i - 1], b = stops[i], f = (t - a[0]) / (b[0] - a[0]);
      return [a[1][0] + (b[1][0] - a[1][0]) * f, a[1][1] + (b[1][1] - a[1][1]) * f, a[1][2] + (b[1][2] - a[1][2]) * f];
    }
    return stops[stops.length - 1][1];
  }
  function stretch(d) {                     // same display stretch as the viewer: 2–99.7 percentile, asinh
    var v = d.filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
    var q = function (p) { return v[Math.min(v.length - 1, Math.max(0, Math.round(p / 100 * (v.length - 1))))]; };
    var lo = q(2), hi = q(99.7), k = Math.asinh(10);
    return d.map(function (x) { return x == null ? null : Math.asinh(10 * Math.min(1, Math.max(0, (x - lo) / Math.max(hi - lo, 1e-12)))) / k; });
  }
  function paint(cv, frame, cell, ramp) {    // crisp integer cells; masked pixels hatched
    var n = Math.round(Math.sqrt(frame.d.length)), s = frame._s || (frame._s = stretch(frame.d)), c = cv.getContext('2d');
    if (cv.width !== n * cell) { cv.width = n * cell; cv.height = n * cell; }
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      var t = s[y * n + x];
      if (t == null) {
        c.fillStyle = '#211b16'; c.fillRect(x * cell, y * cell, cell, cell);
        if (cell >= 6) { c.strokeStyle = '#6b5d50'; c.lineWidth = Math.max(1, cell / 10); c.beginPath(); c.moveTo(x * cell, y * cell + cell); c.lineTo(x * cell + cell, y * cell); c.stroke(); }
      } else { var rgb = lerp(ramp, t); c.fillStyle = 'rgb(' + (rgb[0] | 0) + ',' + (rgb[1] | 0) + ',' + (rgb[2] | 0) + ')'; c.fillRect(x * cell, y * cell, cell, cell); }
    }
  }
  function fmtDate(iso) { var d = new Date(iso.slice(0, 10) + 'T00:00:00Z'); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  window.ScanLoader = function (root, o) {
    o = Object.assign({ mode: 'scan', target: 'this spot', total: 0, plan: null, bands: [], domain: [0.74, 5.01], reducedMotion: false, startAfter: 8 }, o || {});
    var got = [], dead = false, ro = null;
    var bandOf = function (um) { for (var i = 0; i < o.bands.length; i++) if (um >= o.bands[i].min && um <= o.bands[i].max) return o.bands[i]; return null; };
    var rampFor = function (um) {             // black -> band colour -> ivory: the image keeps its real brightness structure
      var b = o.mode === 'scan' && bandOf(um); if (!b) return COPPER;
      var c = hex(b.c); return [[0, [12, 9, 7]], [0.55, c], [1, [255, 246, 232]]];
    };
    root.classList.add('sl'); root.classList.toggle('sl-reduce', !!o.reducedMotion); root.dataset.mode = o.mode; root.innerHTML = '';
    var main = el('div', 'sl-main'); root.appendChild(main);
    var plateWrap, plate, capt, sheet;
    if (o.mode === 'scan') {
      plateWrap = el('div', 'sl-plate'); plate = el('canvas'); plate.setAttribute('role', 'img'); plate.setAttribute('aria-label', 'Latest image to arrive');
      plateWrap.appendChild(plate); main.appendChild(plateWrap);
      capt = el('p', 'sl-capt', '&nbsp;'); main.appendChild(capt);
    } else { sheet = el('div', 'sl-sheet'); main.appendChild(sheet); }
    var rails = el('div', 'sl-rails'); root.appendChild(rails);
    var ruler = null, rulerCv = null;
    if (o.mode === 'scan') {
      ruler = el('div', 'sl-rail sl-ruler');
      ruler.appendChild(el('span', 'sl-rail-l', 'Wavelength'));
      var rb = el('div', 'sl-rail-body'); rulerCv = el('canvas'); rb.appendChild(rulerCv);
      var names = el('div', 'sl-bands');
      o.bands.forEach(function (b) {
        var s = el('span', '', '<i style="background:' + b.c + '"></i>' + esc(b.name));
        s.style.left = pct(b.min) + '%'; s.style.width = (pct(b.max) - pct(b.min)) + '%'; names.appendChild(s);
      });
      rb.appendChild(names);
      var sc = el('div', 'sl-scale'); [1, 2, 3, 4, 5].forEach(function (u) { var s = el('span', '', u + ' µm'); s.style.left = pct(u) + '%'; sc.appendChild(s); }); rb.appendChild(sc);
      ruler.appendChild(rb); rails.appendChild(ruler);
    }
    var dates = el('div', 'sl-rail sl-dates'); dates.appendChild(el('span', 'sl-rail-l', 'Date'));
    var db = el('div', 'sl-rail-body'), datesCv = el('canvas'), dlab = el('div', 'sl-scale'); db.appendChild(datesCv); db.appendChild(dlab); dates.appendChild(db); rails.appendChild(dates);
    var foot = el('div', 'sl-foot');
    var pill = el('div', 'sl-pill'); pill.setAttribute('role', 'status'); pill.hidden = true;
    var pillTxt = el('span'), retry = el('button', 'key', 'Retry now'); retry.type = 'button'; pill.appendChild(pillTxt); pill.appendChild(retry);
    var start = el('button', 'key primary sl-start', 'Start watching'); start.type = 'button'; start.hidden = true;
    var line = el('p', 'sl-line'); line.setAttribute('aria-live', 'polite');
    foot.appendChild(pill); foot.appendChild(start); foot.appendChild(line); root.appendChild(foot);
    retry.onclick = function () { o.onRetry && o.onRetry(); }; start.onclick = function () { o.onStart && o.onStart(); };

    function pct(um) { return (um - o.domain[0]) / (o.domain[1] - o.domain[0]) * 100; }
    function all() { return o.plan && o.plan.length ? o.plan : got; }
    function span() { var a = all(); if (!a.length) return null; var lo = Infinity, hi = -Infinity; a.forEach(function (f) { lo = Math.min(lo, f.mjd); hi = Math.max(hi, f.mjd); }); var pad = Math.max(3, (hi - lo) * 0.02); return [lo - pad, hi + pad]; }
    function seasons() {                      // runs of images less than 60 days apart
      var a = all().slice().sort(function (p, q) { return p.mjd - q.mjd; }), out = [], cur = null;
      a.forEach(function (f, i) { if (!cur || f.mjd - a[i - 1].mjd > 60) { cur = { from: f.mjd, to: f.mjd }; out.push(cur); } else cur.to = f.mjd; });
      return out;
    }
    function mjdLabel(m) { var d = new Date((m - 40587) * 864e5); return MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
    function size(cv) { var r = cv.parentElement.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.round(28 * dpr); cv.style.height = '28px'; return dpr; }
    function rails_() {
      if (dead) return; var c, dpr, w, h, last = got[got.length - 1];
      if (rulerCv) {
        dpr = size(rulerCv); c = rulerCv.getContext('2d'); w = rulerCv.width; h = rulerCv.height; c.clearRect(0, 0, w, h);
        o.bands.forEach(function (b) {          // faint band spans
          var x0 = pct(b.min) / 100 * w, x1 = pct(b.max) / 100 * w; c.fillStyle = 'rgba(255,235,210,.05)'; c.fillRect(x0 + dpr, 6 * dpr, x1 - x0 - 2 * dpr, 16 * dpr);
        });
        (o.plan || []).forEach(function (f) { if (f.um == null) return; c.fillStyle = 'rgba(255,235,210,.16)'; c.fillRect(Math.round(pct(f.um) / 100 * w), 10 * dpr, dpr, 8 * dpr); });
        got.forEach(function (f) { var b = bandOf(f.um); c.fillStyle = b ? b.c : '#E8B678'; c.fillRect(Math.round(pct(f.um) / 100 * w) - dpr / 2, 7 * dpr, 2 * dpr, 14 * dpr); });
        if (last) { c.fillStyle = '#FFF6E8'; c.fillRect(Math.round(pct(last.um) / 100 * w) - dpr, 3 * dpr, 2 * dpr, 22 * dpr); }
      }
      var sp = span(); dpr = size(datesCv); c = datesCv.getContext('2d'); w = datesCv.width; h = datesCv.height; c.clearRect(0, 0, w, h);
      if (!sp) return; var X = function (m) { return (m - sp[0]) / (sp[1] - sp[0]) * w; };
      var ss = seasons(); dlab.innerHTML = '';
      ss.forEach(function (s) {
        c.fillStyle = 'rgba(255,235,210,.07)'; var x0 = X(s.from) - 6 * dpr, x1 = X(s.to) + 6 * dpr; c.beginPath();
        if (c.roundRect) c.roundRect(x0, 6 * dpr, x1 - x0, 16 * dpr, 8 * dpr); else c.rect(x0, 6 * dpr, x1 - x0, 16 * dpr); c.fill();
        var lab = el('span', '', mjdLabel(s.from) === mjdLabel(s.to) ? mjdLabel(s.from) : MON[new Date((s.from - 40587) * 864e5).getUTCMonth()] + '–' + mjdLabel(s.to));
        lab.style.left = ((X(s.from) + X(s.to)) / 2 / w * 100) + '%'; dlab.appendChild(lab);
      });
      (o.plan || []).forEach(function (f) { c.fillStyle = 'rgba(255,235,210,.2)'; c.fillRect(Math.round(X(f.mjd)), 10 * dpr, dpr, 8 * dpr); });
      got.forEach(function (f) { var b = o.mode === 'scan' && bandOf(f.um); c.fillStyle = b ? b.c : '#E8B678'; c.fillRect(Math.round(X(f.mjd)) - dpr / 2, 8 * dpr, 2 * dpr, 12 * dpr); });
      if (last) { c.fillStyle = '#FFF6E8'; c.fillRect(Math.round(X(last.mjd)) - dpr, 4 * dpr, 2 * dpr, 20 * dpr); }
    }
    function text() {
      var tot = o.total || (o.plan ? o.plan.length : 0);
      line.innerHTML = 'Finding images of ' + esc(o.target) + ' · <b>' + got.length + '</b>' + (tot ? ' of ' + tot : '') + ' loaded';
      if (got.length >= o.startAfter && o.onStart) start.hidden = false;
    }
    function plateCell() { var r = plateWrap.getBoundingClientRect(), n = 25; return Math.max(2, Math.floor(Math.min(r.width, r.height) / n)); }
    function showPlate(f) {
      var cell = plateCell(), dpr = Math.min(window.devicePixelRatio || 1, 2), n = Math.round(Math.sqrt(f.d.length));
      paint(plate, f, Math.max(1, Math.round(cell * dpr)), rampFor(f.um)); plate.style.width = plate.style.height = (n * cell) + 'px';
      var b = bandOf(f.um);
      capt.innerHTML = (b ? '<i style="background:' + b.c + '"></i>' + esc(b.name) + ' <span>·</span> ' : '') + 'λ ' + f.um.toFixed(2) + ' µm <span>·</span> D' + f.det + ' <span>·</span> ' + fmtDate(f.date);
      if (!o.reducedMotion) { plate.classList.remove('sl-in'); void plate.offsetWidth; plate.classList.add('sl-in'); }
    }
    function addTile(f) {
      if (sheet.children.length >= 120) { sheet.dataset.more = '+' + (got.length - 120) + ' more'; return; }
      var cv = el('canvas'); paint(cv, f, 3, COPPER); cv.title = fmtDate(f.date) + ' · ' + f.um.toFixed(2) + ' µm'; sheet.appendChild(cv);
    }
    var api = {
      add: function (f) { if (dead) return; got.push(f); if (o.mode === 'scan') showPlate(f); else addTile(f); rails_(); text(); },
      set: function (p) { Object.assign(o, p || {}); rails_(); text(); },      // update target, total or plan once the archive answers
      slow: function (msg) { pill.hidden = !msg; if (msg) pillTxt.textContent = msg; },
      done: function () { root.classList.add('sl-done'); },
      destroy: function () { dead = true; if (ro) ro.disconnect(); root.innerHTML = ''; root.classList.remove('sl', 'sl-done', 'sl-reduce'); }
    };
    if (window.ResizeObserver) { ro = new ResizeObserver(function () { rails_(); if (o.mode === 'scan' && got.length) showPlate(got[got.length - 1]); }); ro.observe(root); }
    rails_(); text();
    return api;
  };
})();
